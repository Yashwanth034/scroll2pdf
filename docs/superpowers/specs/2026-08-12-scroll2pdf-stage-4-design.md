# Scroll2PDF Stage 4 Design: A4 PDF Engine

## Scope

Stage 4 converts the already-stitched image produced by Full Page, Scrollable Area, or Selected Area capture into a local A4 PDF. Long Image remains unchanged. This stage does not add site-specific capture, virtualized-history reconstruction, iframe capture, or other Stage 5 behavior.

## Output pipeline

The existing capture and stitching pipeline remains authoritative:

1. Capture and restore the webpage using the Stage 1–3 engines.
2. Store the stitched long image as a temporary IndexedDB result.
3. If output is Long Image, open that result unchanged.
4. If output is A4 PDF, ask the offscreen document to plan page boundaries.
5. Render and encode one source band at a time.
6. Assemble a custom raster PDF locally.
7. Store the final PDF, delete the temporary long image, and open the existing result page.

The background service worker orchestrates each PDF page so progress and cancellation remain visible and recoverable after the popup closes.

## A4 geometry

- Portrait: 210 × 297 mm.
- Landscape: 297 × 210 mm.
- Margin: 10 mm on every side.
- PDF coordinates: points, using 72 points per inch and 25.4 mm per inch.
- The bitmap is scaled uniformly to the available page width; X and Y are never stretched independently.
- Upscaling is capped at 1.25 PDF points per source pixel to avoid absurd enlargement of narrow captures.
- Each band is top-aligned inside the content area and centered horizontally on a white A4 page.

## Pagination and smart breaks

The ideal source-band height is the available PDF content height divided by the uniform PDF scale. Each next boundary starts at the preceding boundary, so every source row belongs to exactly one page.

For non-final pages, the planner searches upward from the ideal boundary for a nearby visually quiet horizontal band. The search is limited to 8% of the ideal source-band height, capped at 256 source pixels, and may shorten a page by no more than 10%. A horizontally downsampled strip is scored using luminance variance, horizontal detail, and difference from adjacent rows. Sustained low-information rows are preferred. If no meaningfully quieter band exists, the exact mathematical boundary is used.

Searching only upward ensures that a smart break never makes a band exceed the printable A4 height. A moved boundary becomes the exact start of the following page; no overlap is introduced.

## PDF format

A small project-owned PDF writer emits PDF 1.7 objects, page trees, image XObjects, content streams, metadata, cross-reference data, and a trailer. No remote or third-party runtime code is used.

- High quality: lossless RGB image bands compressed with DEFLATE and embedded with `/FlateDecode`.
- Standard quality: JPEG bands at approximately 84% quality and embedded with `/DCTDecode`.
- Metadata: sanitized title/filename, Creator and Producer set to Scroll2PDF, and the creation date.

## Memory strategy

The offscreen document decodes the stitched source once. Page boundaries are planned in a lightweight pass. A single page canvas is then reused sequentially: crop a band, encode it, append its compressed bytes to the PDF writer, clear temporary canvas data, and continue. The system never creates all page canvases or encoded page blobs simultaneously. The existing bitmap/canvas limits remain, with an additional maximum of 500 PDF pages.

## Progress, cancellation, and cleanup

PDF generation introduces a `creating-pdf` phase. The popup reports `Creating PDF… i / N`, then `PDF complete`. Closing and reopening the popup reads the current phase from the capture manager.

Cancel sends the existing cancellation signal to the offscreen document. Planning and every page render check cancellation. Cancellation discards the partial PDF, deletes the temporary stitched-image result, creates no result page, and reports `Capture cancelled`. Webpage/container restoration already completes before PDF conversion begins and is preserved on every outcome.

## Result UI

For PDFs, the result page shows capture mode, A4 PDF, orientation, page count, file size, source dimensions, Download PDF, and Close. A full embedded PDF renderer is intentionally omitted. Long Image preview/download behavior remains unchanged. Orientation is visible and enabled only when A4 PDF output is selected.

## Security and permissions

All processing remains local. There is no network access, remote code, CDN, `eval`, debugger use, or webpage-content transmission. The existing `offscreen` permission is sufficient; Stage 4 adds no permission.
