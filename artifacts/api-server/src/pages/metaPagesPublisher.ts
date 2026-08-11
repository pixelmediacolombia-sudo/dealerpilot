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
    return {
      postId,
      postUrl: typeof post.permalink_url === "string" ? post.permalink_url : null,
    };
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
