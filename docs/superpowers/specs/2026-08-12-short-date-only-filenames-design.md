# Short Date-Only Filenames Design

Date: 2026-08-12

## Goal

Shorten every generated capture filename by removing the website hostname and capture time.

## Naming Contract

Generated files use `scroll2pdf-YYYY-MM-DD.ext`, where the extension continues to match the actual output:

- High-quality images and Screenshot output: `scroll2pdf-2026-08-12.png`
- Standard-quality images: `scroll2pdf-2026-08-12.jpg`
- PDF output: `scroll2pdf-2026-08-12.pdf`

The date remains the existing UTC capture date so this change does not silently alter date semantics. The browser may append its normal duplicate suffix, such as `(1)` or `(2)`, when several files with the same name are downloaded on one day.

## Architecture

Only the shared image, PDF, and release filename builders change. Their public function signatures remain unchanged so Full Page, Scrollable Area, Selected Area, Screenshot, Long Image, and A4 PDF callers require no changes.

The URL argument remains accepted for compatibility but no longer contributes to the filename. Image quality continues to determine PNG versus JPG, and the PDF builder continues to produce `.pdf`.

## Error Handling

Invalid dates continue to be rejected exactly as before. Since URLs are no longer parsed for filenames, malformed or missing URLs cannot lengthen or alter the generated name.

## Testing

Implementation follows test-driven development:

- update image filename tests first to expect date-only PNG and JPG names;
- update PDF filename tests first to expect the date-only PDF name;
- update release-security assertions so filenames contain neither hostname, page title, nor chat text;
- observe the expected failures before modifying production builders;
- run all unit, stage, popup, result, and browser-independent regression suites after the minimal change.

## Non-Goals

- No custom duplicate-number generator.
- No changes to output quality, file contents, result-page downloads, capture modes, or browser download behavior.
- No change from UTC date calculation to local date calculation.

## Acceptance Criteria

All generated image and PDF filenames contain only the `scroll2pdf` prefix, UTC capture date, and correct extension. They contain no hostname or time, and all capture behavior remains unchanged.
