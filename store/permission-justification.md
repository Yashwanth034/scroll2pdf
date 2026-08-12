# Permission justification

- `activeTab`: access the user-selected active webpage after the capture action.
- `offscreen`: decode screenshots, stitch Canvas frames, generate local PDFs, and manage local Blobs outside the service worker.
- `scripting`: retained for the declared page-interaction architecture.
- HTTP/HTTPS host access: run the local content script on ordinary webpages for selection, scrolling, measurement, and restoration.

No debugger, cookies, downloads, webRequest, native messaging, clipboard, or network permission is requested.
