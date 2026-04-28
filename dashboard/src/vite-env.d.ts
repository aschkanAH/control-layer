/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_BUILD_SHA?: string;
  // URL of the Zapier (or other) webhook used by the onboarding "invite a
  // teammate" form. Fire-and-forget POST under `no-cors`, so the host does
  // not need CORS headers configured. Leave unset to disable the form.
  readonly VITE_INVITE_WEBHOOK_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module "*.svg" {
  const content: string;
  export default content;
}
