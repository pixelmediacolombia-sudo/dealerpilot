export interface MetaPagesPublisherConfig {
  pageId: string;
  pageAccessToken: string;
  graphApiVersion: string;
}

export interface PageVehiclePostInput {
  message: string;
  imageUrls: string[];
}

export interface PagePostResult {
  postId: string;
  postUrl: string | null;
}

export const REQUIRED_PAGE_PERMISSIONS = ["pages_manage_posts"] as const;

export interface MetaPageValidation {
  ok: boolean;
  pageId: string;
  pageName: string | null;
  grantedPermissions: string[];
  missingPermissions: string[];
  permissionSource: "debug_token" | "stored_scopes" | "unavailable";
  tokenExpiresAt: string | null;
  error: string | null;
}

export type MetaFetch = typeof fetch;

export function readMetaPagesConfig(env: NodeJS.ProcessEnv = process.env): MetaPagesPublisherConfig | null {
  const pageId = env.META_PAGE_ID?.trim();
  const pageAccessToken = env.META_PAGE_ACCESS_TOKEN?.trim();
  if (!pageId || !pageAccessToken) return null;
  return {
    pageId,
    pageAccessToken,
    graphApiVersion: env.META_GRAPH_API_VERSION?.trim() || "v23.0",
  };
}

export async function validateMetaPageConnection(
  config: MetaPagesPublisherConfig,
  storedScopes: string[] = [],
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: MetaFetch = fetch,
): Promise<MetaPageValidation> {
  const graphBase = `https://graph.facebook.com/${config.graphApiVersion}`;
  const grantedFromStorage = [...new Set(storedScopes.map((scope) => scope.trim()).filter(Boolean))];
  let grantedPermissions = grantedFromStorage;
  let permissionSource: MetaPageValidation["permissionSource"] = grantedFromStorage.length > 0
    ? "stored_scopes"
    : "unavailable";
  let tokenExpiresAt: string | null = null;

  try {
    const pageResponse = await fetchImpl(
      `${graphBase}/${encodeURIComponent(config.pageId)}?fields=id,name&access_token=${encodeURIComponent(config.pageAccessToken)}`,
      { method: "GET" },
    );
    const pagePayload = (await pageResponse.json().catch(() => ({}))) as Record<string, unknown>;
    if (!pageResponse.ok || pagePayload.error) {
      const error = pagePayload.error as { message?: string } | undefined;
      return {
        ok: false,
        pageId: config.pageId,
        pageName: null,
        grantedPermissions,
        missingPermissions: [...REQUIRED_PAGE_PERMISSIONS],
        permissionSource,
        tokenExpiresAt,
        error: error?.message || `Meta Page validation failed (${pageResponse.status})`,
      };
    }

    const returnedPageId = typeof pagePayload.id === "string" ? pagePayload.id : null;
    if (returnedPageId !== config.pageId) {
      return {
        ok: false,
        pageId: config.pageId,
        pageName: typeof pagePayload.name === "string" ? pagePayload.name : null,
        grantedPermissions,
        missingPermissions: [...REQUIRED_PAGE_PERMISSIONS],
        permissionSource,
        tokenExpiresAt,
        error: "Meta returned a different Page ID than the configured connection",
      };
    }

    const appId = env.META_APP_ID?.trim();
    const appSecret = env.META_APP_SECRET?.trim();
    if (appId && appSecret) {
      const debugResponse = await fetchImpl(
        `${graphBase}/debug_token?input_token=${encodeURIComponent(config.pageAccessToken)}&access_token=${encodeURIComponent(`${appId}|${appSecret}`)}`,
        { method: "GET" },
      );
      const debugPayload = (await debugResponse.json().catch(() => ({}))) as Record<string, unknown>;
      const debugData = (debugPayload.data ?? {}) as Record<string, unknown>;
      if (!debugResponse.ok || debugPayload.error || debugData.is_valid === false) {
        const error = debugPayload.error as { message?: string } | undefined;
        return {
          ok: false,
          pageId: config.pageId,
          pageName: typeof pagePayload.name === "string" ? pagePayload.name : null,
          grantedPermissions,
          missingPermissions: [...REQUIRED_PAGE_PERMISSIONS],
          permissionSource: "debug_token",
          tokenExpiresAt,
          error: error?.message || "Meta rejected the Page access token during debug validation",
        };
      }

      const debugScopes = Array.isArray(debugData.scopes)
        ? debugData.scopes.filter((scope): scope is string => typeof scope === "string")
        : [];
      grantedPermissions = [...new Set([...grantedPermissions, ...debugScopes])];
      permissionSource = "debug_token";
      if (typeof debugData.expires_at === "number" && debugData.expires_at > 0) {
        tokenExpiresAt = new Date(debugData.expires_at * 1000).toISOString();
      }
    }

    const missingPermissions = REQUIRED_PAGE_PERMISSIONS.filter((scope) => !grantedPermissions.includes(scope));
    return {
      ok: missingPermissions.length === 0,
      pageId: config.pageId,
      pageName: typeof pagePayload.name === "string" ? pagePayload.name : null,
      grantedPermissions,
      missingPermissions,
      permissionSource,
      tokenExpiresAt,
      error: missingPermissions.length > 0
        ? `Missing required Meta permission: ${missingPermissions.join(", ")}`
        : null,
    };
  } catch (error) {
    return {
      ok: false,
      pageId: config.pageId,
      pageName: null,
      grantedPermissions,
      missingPermissions: [...REQUIRED_PAGE_PERMISSIONS],
      permissionSource,
      tokenExpiresAt,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export class MetaPagesPublisher {
  constructor(
    private readonly config: MetaPagesPublisherConfig,
    private readonly fetchImpl: MetaFetch = fetch,
  ) {}

  async publishVehicle(input: PageVehiclePostInput): Promise<PagePostResult> {
    const imageUrls = input.imageUrls.filter(Boolean);
    if (imageUrls.length === 0) throw new Error("Pages publish requires at least one image");
    if (imageUrls.some((url) => !/^https:\/\//i.test(url))) {
      throw new Error("Pages publish requires publicly reachable HTTPS image URLs");
    }

    const graphBase = `https://graph.facebook.com/${this.config.graphApiVersion}`;
    const attachedMedia: Array<{ media_fbid: string }> = [];
    for (const imageUrl of imageUrls.slice(0, 10)) {
      const photo = await this.callGraph(`${graphBase}/${this.config.pageId}/photos`, {
        url: imageUrl,
        published: "false",
      });
      const mediaId = typeof photo.id === "string" ? photo.id : null;
      if (!mediaId) throw new Error("Meta photo upload did not return a media id");
      attachedMedia.push({ media_fbid: mediaId });
    }

    const post = await this.callGraph(`${graphBase}/${this.config.pageId}/feed`, {
      message: input.message,
      attached_media: JSON.stringify(attachedMedia),
    });
    const postId = typeof post.id === "string" ? post.id : typeof post.post_id === "string" ? post.post_id : null;
    if (!postId) throw new Error("Meta Page post did not return a post id");

    let postUrl = typeof post.permalink_url === "string" ? post.permalink_url : null;
    if (!postUrl) {
      const permalink = await this.readGraph(
        `${graphBase}/${encodeURIComponent(postId)}?fields=permalink_url`,
      );
      postUrl = typeof permalink.permalink_url === "string" ? permalink.permalink_url : null;
    }
    return {
      postId,
      postUrl,
    };
  }

  private async readGraph(url: string): Promise<Record<string, unknown>> {
    const response = await this.fetchImpl(`${url}&access_token=${encodeURIComponent(this.config.pageAccessToken)}`, {
      method: "GET",
    });
    const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok || payload.error) {
      const error = payload.error as { message?: string } | undefined;
      throw new Error(error?.message || `Meta Graph API request failed (${response.status})`);
    }
    return payload;
  }

  private async callGraph(url: string, body: Record<string, string>): Promise<Record<string, unknown>> {
    const params = new URLSearchParams({ ...body, access_token: this.config.pageAccessToken });
    const response = await this.fetchImpl(url, { method: "POST", body: params });
    const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok || payload.error) {
      const error = payload.error as { message?: string } | undefined;
      throw new Error(error?.message || `Meta Graph API request failed (${response.status})`);
    }
    return payload;
  }
}
