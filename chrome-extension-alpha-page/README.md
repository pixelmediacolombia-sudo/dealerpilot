# DealerPilot Page Publisher

This extension is intentionally separate from `DealerPilot AI Publisher`.

It prepares Facebook Page drafts for `Alpha MotorSports: Easy Credit / Credito Facil`
inside Meta Business Suite using DealerPilot inventory payloads. It does not use
Meta Developers, does not use Graph API tokens, and never clicks `Publish`.

## Flow

1. Open the extension popup.
2. Select a vehicle from DealerPilot.
3. Click `Prepare Business Suite draft`.
4. The extension opens the Alpha Business Suite composer.
5. The content script fills the text and uploads up to 10 photos.
6. A human reviews the destination, text, photos, and manually clicks `Publish`.

## Target

- Facebook Page ID: `265746649947861`
- Business ID: `7725528554132936`
- Page: `Alpha MotorSports: Easy Credit / Credito Facil`

Business Suite may also show Instagram `alphamotorsportlatino` selected. The
extension warns about that state, but the human reviewer must remove Instagram
before publishing if the post should be Facebook Page only.
