## GPM architecture
- Cloud Auth owns identity; device session summaries never authorize server actions. Roles stay in user_roles.
- Shared operation rows use stable entity IDs, revision checks and tombstones; local storage is an offline cache and durable outbox, not cloud truth.
- First property setup is an authenticated atomic RPC, so concurrent setup cannot create duplicate administrators.
- Restaurant room folios derive charges from settled sales rather than mutating booking totals, preventing duplicate posting.
- Web updates use explicit confirmed worker activation and preserve origin storage/caches; plugin generation must retain skipWaiting=false and clientsClaim=false to prevent consent bypass.
- The Android app packages local web assets and must not configure a remote application URL; Supabase authentication and cloud synchronization still require a network.
- App installation uses a shared root provider for the browser prompt; hide installation in standalone/Electron and provide browser-specific fallback only after a user click.
