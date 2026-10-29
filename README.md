# GreenLight Vibe

Convert HTML to WordPress Gutenberg blocks using the Greenshift/GreenLight system. Build designs, convert any format to blocks, add charts, tables, and dynamic content.

Works with any AI assistant that can read files and run Node.js. Nothing in this skill depends on a specific model or tool.

## Installation

Copy the `skills/greenlight-vibe/` folder wherever your AI tool loads skills or instructions from, or point the assistant at `skills/greenlight-vibe/SKILL.md` and ask it to follow it. The only requirement is Node.js to run the converter scripts.

## Skill

`SKILL.md` is the entry point. Load it when working on **WordPress**, **Gutenberg**, **Greenshift**, **GreenLight**, converting content to blocks, or building charts.

### Workflow

1. **Build HTML** -- The assistant creates clean vanilla HTML + CSS + JS following the Greenshift conventions in `SKILL.md`
2. **Convert** -- The zero-dependency `scripts/convert.js` transforms HTML into block code (resolves the CSS onto each block as native `styleAttributes`, attaches JS to the block it targets, maps all HTML attributes)
3. **Deconvert when editing** -- The zero-dependency `scripts/deconvert.js` turns Greenshift block code back into HTML/CSS/JS for larger edits
4. **Validate** -- The assistant checks output against block syntax rules
5. **Variable fitting** -- Replaces hardcoded values with WordPress CSS variables

## File Structure

```
greenlight-vibe/
├── skills/
│   └── greenlight-vibe/
│       ├── SKILL.md                 # Main instructions (entry point)
│       ├── scripts/
│       │   ├── convert.js           # HTML-to-blocks converter (zero-dependency)
│       │   └── deconvert.js         # Blocks-to-HTML converter (zero-dependency)
│       └── instructions/
│           ├── core-structure.md    # Block format, JSON parameters
│           ├── attributes.md        # HTML attributes, links, images, icons
│           ├── variables.md         # CSS variables (fonts, spacing, shadows)
│           ├── scripts.md           # Custom JavaScript
│           ├── charts.md            # ApexCharts integration
│           ├── dynamic-placeholders.md # Dynamic placeholders
│           ├── dynamic-loops.md     # Query loop syntax
│           ├── global-settings.md   # Sync CSS variables and fonts to GreenShift
│           ├── validate-styles.md   # Frontend CSS rendering (CSSRender)
│           └── validate-scripts.md  # Frontend script loading
└── README.md
```

## Converter Scripts

The `scripts/convert.js` is a standalone, zero-dependency Node.js script that converts full HTML pages or snippets into Greenshift block code:

```bash
node scripts/convert.js input.html                # stdout
node scripts/convert.js input.html -o output.txt  # file
cat input.html | node scripts/convert.js          # stdin
```

The `scripts/deconvert.js` reverses the process and converts Greenshift block code back into HTML/CSS/JS:

```bash
node scripts/deconvert.js input.txt                # stdout
node scripts/deconvert.js input.txt -o output.html # file
cat input.txt | node scripts/deconvert.js          # stdin
```

**Features:**
- Custom HTML parser (no npm packages required)
- No Style Manager block: the CSS cascade is resolved per element and stored on its own block as native `styleAttributes`, editable in each block's panel (responsive values on GreenShift's breakpoints, hover states, animations with keyframes)
- Typography is placed on the blocks that render text, so every text element carries its own values
- CSS without a native setting stays as `customCSS_Extra` on the block it belongs to
- JS attached as `customJs` / `customJsEnabled` to the block it targets
- Random, unique block ids; markup matches GreenShift's save() so blocks validate in the editor
- Full element mapping: links, images, SVGs, videos, forms, tables, section/content-area variations
- `deconvert.js` rebuilds a readable stylesheet from the blocks' `styleAttributes` for larger edits

## Author

**WPsoul** - [@mr_igor_sanz](https://x.com/mr_igor_sanz)

## License

MIT