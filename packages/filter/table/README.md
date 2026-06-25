# pugneum-filter-table

Pipe-delimited table syntax for pugneum templates. The filter is `type: 'pugneum'`:
its output is pugneum source that the filterer re-lexes into table markup.

## Installation

    npm install pugneum-filter-table

## Usage

Apply the filter with a leading colon and write a Markdown-like table in the body:

```
:table
  | Name  | Count |
  | ---   | ---   |
  | Alice | 42    |
```

renders:

```
<table>
  <colgroup><col><col></colgroup>
  <thead><tr><th scope="col">Name</th><th scope="col">Count</th></tr></thead>
  <tbody><tr><td>Alice</td><td>42</td></tr></tbody>
</table>
```

## Grammar

- **Rows** are pipe-delimited. Leading and trailing pipes are optional, so
  `| a | b |`, `a | b`, and `| a | b` are equivalent. A trailing/leading pipe just
  produces an empty edge cell that is dropped.
- **Header separator** `| --- | --- |`: the rows above it become a `<thead>`, the
  rows below begin a `<tbody>`. A second `---` starts another `<tbody>`.
- **Footer separator** `| === |`: the rows below it become a `<tfoot>`. It may
  appear at most once and not after a `tfoot` marker.
- **Alignment** in a separator cell: `:---` left, `---:` right, `:---:` center.
  Each separator column emits a `<col>`; alignment becomes
  `col(style="text-align:...")`.
- **Per-column attributes** in a separator cell: `---(class="x")---`. Combined with
  alignment (`:---(class="x")---:`), both are emitted; if the attribute is `style`,
  the alignment is merged into it (one `style` attribute, never two).
- **Colgroup boundaries**: `||` in a *separator* row splits columns into separate
  `<colgroup>` elements. In a *data* row, `||` is treated as a single `|`.
- **Caption**: a leading `caption text` or `caption(attrs) text` line.
- **Section markers**: a `thead`, `tbody`, or `tfoot` line (optionally with
  `(attrs)`) on its own declares the section for the rows that follow. A table may
  have at most one `<thead>` and one `<tfoot>`, and `<tfoot>` must come last;
  violating this is an error.
- **Row attributes**: a `tr(attrs)` prefix before the first pipe on a row applies
  attributes to that `<tr>`.
- **Tagged cells**: a cell beginning with `th` or `td` followed by an optional
  balanced `(attrs)` group and then whitespace or end of cell is emitted verbatim,
  letting you set per-cell attributes (`td(colspan="2") x`). Header cells in
  `thead` get `scope="col"` automatically. An unbalanced parenthesis (e.g.
  `th(scope value`) is treated as plain data, not a tag. Tag `.class`/`#id`
  shorthands are not recognized in a cell — use an explicit `(attrs)` group (so a
  cell like `td.5` is treated as ordinary data).
- **Escapes**: prefix a cell with `\` (`\td foo`) to keep literal text that would
  otherwise be read as a tagged cell.
- **Box-drawing input**: Unicode box-drawing characters are normalized before
  parsing — single-line verticals/junctions (`│ ├ ┤ ┼`) become `|`, double-line
  ones (`║ ╠ ╣ ╬`) become `||` (colgroup boundaries), `─`/`═` become `-`/`=`, and
  decorative corners (`┌ ┐ └ ┘` etc.) are stripped — so a full box-drawn table is
  accepted.

## Cell content contract

Because this filter is `type: 'pugneum'`, **cell and caption text is re-lexed as
pugneum inline content**:

- **Inline shorthands are active.** `*(strong)`, `_(em)`, `` `(code)` ``,
  `@(url text)`, `#(tag text)`, etc. all fire inside cell/caption text. This is the
  feature that lets tables contain rich inline markup.
- **A literal `#{` is neutralized.** `#{name}` is variable interpolation, which is
  illegal outside a mixin, so the filter escapes a literal `#{` in cell/caption
  text — a table documenting shell prompts or pugneum syntax will not crash.
- **HTML metacharacters follow pugneum's normal text rules.** As with hand-written
  pugneum text, `<`, `>`, and `&` in cell text are emitted as-is (not
  HTML-escaped). If you splice externally-sourced data into a `:table` block, treat
  cell content as pugneum source, not opaque data.

## License

  MIT
