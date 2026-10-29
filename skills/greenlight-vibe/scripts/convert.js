#!/usr/bin/env node

// HTML to Greenshift WordPress Blocks Converter
// Zero-dependency. Reads HTML from file path (arg) or stdin.
// Usage:
//   node convert.js input.html
//   cat input.html | node convert.js

'use strict';

// ─── Tiny HTML Parser (no dependencies) ──────────────────────────────────────

const VOID_TAGS = new Set([
  'area','base','br','col','embed','hr','img','input',
  'link','meta','param','source','track','wbr'
]);

const SKIP_TAGS = new Set([
  'script','style','meta','link','head','title','noscript','template'
]);

const RAW_TEXT_TAGS = new Set(['script','style']);

function parseHTML(html) {
  let pos = 0;
  const len = html.length;

  function peek() { return html[pos]; }
  function advance(n) { pos += (n || 1); }
  function remaining() { return pos < len; }

  function skipWhitespace() {
    while (remaining() && /\s/.test(html[pos])) pos++;
  }

  function readUntil(stop) {
    const start = pos;
    const idx = html.indexOf(stop, pos);
    if (idx === -1) { pos = len; return html.slice(start); }
    pos = idx;
    return html.slice(start, idx);
  }

  function readAttribute() {
    skipWhitespace();
    let name = '';
    while (remaining() && !/[\s=/>]/.test(html[pos])) {
      name += html[pos]; pos++;
    }
    if (!name) return null;
    name = name.toLowerCase();
    skipWhitespace();
    if (html[pos] !== '=') return { name, value: '' };
    pos++; // skip =
    skipWhitespace();
    let value = '';
    const quote = html[pos];
    if (quote === '"' || quote === "'") {
      pos++;
      while (remaining() && html[pos] !== quote) {
        value += html[pos]; pos++;
      }
      if (remaining()) pos++; // skip closing quote
    } else {
      while (remaining() && !/[\s>]/.test(html[pos])) {
        value += html[pos]; pos++;
      }
    }
    return { name, value };
  }

  function readTag() {
    pos++; // skip <
    // Check for closing tag
    if (html[pos] === '/') {
      pos++;
      const tagName = readUntil('>').trim().toLowerCase();
      pos++; // skip >
      return { type: 'close', tagName };
    }
    // Check for comment
    if (html.slice(pos, pos + 3) === '!--') {
      pos += 3;
      const content = readUntil('-->');
      pos += 3;
      return { type: 'comment', content };
    }
    // Check for doctype
    if (html.slice(pos, pos + 1).toUpperCase() === '!' || html.slice(pos, pos + 7).toLowerCase() === 'doctype') {
      readUntil('>'); pos++;
      return { type: 'doctype' };
    }
    // Open tag
    let tagName = '';
    while (remaining() && !/[\s/>]/.test(html[pos])) {
      tagName += html[pos]; pos++;
    }
    tagName = tagName.toLowerCase();
    const attributes = {};
    while (remaining()) {
      skipWhitespace();
      if (html[pos] === '>' || (html[pos] === '/' && html[pos + 1] === '>')) break;
      const attr = readAttribute();
      if (attr) attributes[attr.name] = attr.value;
      else break;
    }
    let selfClosing = false;
    if (html[pos] === '/') { selfClosing = true; pos++; }
    if (html[pos] === '>') pos++;
    selfClosing = selfClosing || VOID_TAGS.has(tagName);
    return { type: 'open', tagName, attributes, selfClosing };
  }

  function parseNodes() {
    const nodes = [];
    while (remaining()) {
      if (html[pos] === '<') {
        // Check for closing tag without consuming
        if (html[pos + 1] === '/') break;
        const tagStartPos = pos;
        const tag = readTag();
        if (!tag || tag.type === 'comment' || tag.type === 'doctype') continue;
        if (tag.type === 'close') break;
        if (tag.type === 'open') {
          const node = {
            type: 'element',
            tagName: tag.tagName,
            attributes: tag.attributes,
            children: [],
            outerHTML: ''
          };
          if (tag.selfClosing) node.outerHTML = html.slice(tagStartPos, pos);
          if (tag.tagName === 'svg') {
            const svgCloseIdx = html.indexOf('</svg>', pos);
            if (svgCloseIdx !== -1) {
              const innerSvg = html.slice(pos, svgCloseIdx);
              pos = svgCloseIdx + 6;
              node.outerHTML = html.slice(tagStartPos, pos);
              node.rawInner = innerSvg;
            }
            nodes.push(node);
            continue;
          }
          if (RAW_TEXT_TAGS.has(tag.tagName) && !tag.selfClosing) {
            const closeTag = `</${tag.tagName}>`;
            const endIdx = html.toLowerCase().indexOf(closeTag, pos);
            if (endIdx !== -1) {
              node.rawText = html.slice(pos, endIdx);
              pos = endIdx + closeTag.length;
            }
            nodes.push(node);
            continue;
          }
          if (!tag.selfClosing) {
            node.children = parseNodes();
            // Skip closing tag
            if (html[pos] === '<' && html[pos + 1] === '/') {
              readUntil('>'); pos++;
            }
          }
          nodes.push(node);
        }
      } else {
        let text = '';
        while (remaining() && html[pos] !== '<') {
          text += html[pos]; pos++;
        }
        if (text.trim()) {
          nodes.push({ type: 'text', content: text.trim() });
        }
      }
    }
    return nodes;
  }

  return parseNodes();
}

// ─── CSS Parser ──────────────────────────────────────────────────────────────

const SUPPORTED_CSS_PROPS = new Set([
  'textShadow','textStroke','textDecoration','textWrap','wordBreak','letterSpacing','lineClamp','fontStyle','writingMode','textOrientation','fontVariationSettings','fontFamily','fontWeight','fontSize','lineHeight','textAlign','textTransform','textOverflow','font',
  'backgroundImage','backgroundColor','backgroundRepeat','backgroundSize','backgroundAttachment','backgroundBlendMode','backgroundClip','backgroundPosition','color','stroke','strokeWidth','fill',
  'marginTop','marginBottom','marginLeft','marginRight','paddingTop','paddingBottom','paddingLeft','paddingRight','overflow','overflowX','overflowY',
  'border','borderRadius','borderTop','borderBottom','borderLeft','borderRight','borderWidth','borderStyle','borderColor','borderTopWidth','borderTopStyle','borderTopColor','borderBottomWidth','borderBottomStyle','borderBottomColor','borderLeftWidth','borderLeftStyle','borderLeftColor','borderRightWidth','borderRightStyle','borderRightColor','borderBottomLeftRadius','borderBottomRightRadius','borderTopLeftRadius','borderTopRightRadius',
  'boxShadow',
  'width','height','minWidth','minHeight','maxWidth','maxHeight','aspectRatio','scrollbarWidth','scrollbarColor','scrollSnapType','scrollSnapAlign','objectFit','objectPosition','touchAction',
  'position','top','right','bottom','left','zIndex','anchorName','inset','positionAnchor','positionArea','positionTryFallbacks','isolation',
  'opacity','mixBlendMode','filter','visibility','cursor','pointerEvents','maskImage','clipPath','maskRepeat','maskClip','maskComposite','maskType','maskSize','maskPosition','maskOrigin','maskMode','backdropFilter','animation','animationTimeline','animationRange','scrollTimeline','viewTimeline','animationComposition','animationDelay','animationDirection','animationDuration','animationFillMode','animationIterationCount','animationName','animationPlayState','animationTimingFunction',
  'transition','transitionProperty','transitionDuration','transitionTimingFunction','transitionDelay','transform','perspective','transformOrigin','transformStyle','backfaceVisibility',
  'display','flexDirection','justifyContent','alignItems','alignContent','flexWrap','columnGap','rowGap','gridTemplateColumns','gridTemplateRows','order','flexGrow','flexShrink','flexBasis','alignSelf','gridTemplate','gridColumn','gridRow','justifySelf','gridAutoFlow','boxSizing',
  'margin','padding','background','gap','outline','outlineColor','outlineStyle','outlineWidth','outlineOffset'
]);

function toCamelCase(str) {
  return str.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

function parseSpacingShorthand(value, prefix) {
  // Whitespace inside calc(), clamp(), var() fallbacks, quoted strings, etc.
  // does not separate shorthand components.
  const parts = splitCssTokens(value);
  const r = {};
  if (parts.length === 1) {
    r[`${prefix}Top`] = responsiveValue(parts[0]); r[`${prefix}Right`] = responsiveValue(parts[0]);
    r[`${prefix}Bottom`] = responsiveValue(parts[0]); r[`${prefix}Left`] = responsiveValue(parts[0]);
  } else if (parts.length === 2) {
    r[`${prefix}Top`] = responsiveValue(parts[0]); r[`${prefix}Bottom`] = responsiveValue(parts[0]);
    r[`${prefix}Right`] = responsiveValue(parts[1]); r[`${prefix}Left`] = responsiveValue(parts[1]);
  } else if (parts.length === 3) {
    r[`${prefix}Top`] = responsiveValue(parts[0]); r[`${prefix}Right`] = responsiveValue(parts[1]);
    r[`${prefix}Left`] = responsiveValue(parts[1]); r[`${prefix}Bottom`] = responsiveValue(parts[2]);
  } else if (parts.length >= 4) {
    r[`${prefix}Top`] = responsiveValue(parts[0]); r[`${prefix}Right`] = responsiveValue(parts[1]);
    r[`${prefix}Bottom`] = responsiveValue(parts[2]); r[`${prefix}Left`] = responsiveValue(parts[3]);
  }
  return r;
}

function responsiveValue(value) {
  return [value, null, null, null];
}

function splitCssTokens(value) {
  const tokens = [];
  let current = '';
  let depth = 0;
  let quote = '';

  for (let index = 0; index < value.length; index++) {
    const char = value[index];

    if (quote) {
      current += char;
      if (char === quote && value[index - 1] !== '\\') quote = '';
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      current += char;
      continue;
    }

    if (char === '(') {
      depth++;
      current += char;
      continue;
    }

    if (char === ')') {
      depth = Math.max(0, depth - 1);
      current += char;
      continue;
    }

    if (/\s/.test(char) && depth === 0) {
      if (current) {
        tokens.push(current);
        current = '';
      }
      continue;
    }

    current += char;
  }

  if (current) tokens.push(current);
  return tokens;
}

function splitCssTopLevel(value, delimiter) {
  const parts = [];
  let current = '';
  let parenDepth = 0;
  let bracketDepth = 0;
  let braceDepth = 0;
  let quote = '';
  let inComment = false;

  for (let index = 0; index < value.length; index++) {
    const char = value[index];
    const next = value[index + 1];

    if (inComment) {
      current += char;
      if (char === '*' && next === '/') {
        current += next;
        index++;
        inComment = false;
      }
      continue;
    }

    if (!quote && char === '/' && next === '*') {
      current += char + next;
      index++;
      inComment = true;
      continue;
    }

    if (quote) {
      current += char;
      if (char === quote && value[index - 1] !== '\\') quote = '';
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      current += char;
      continue;
    }

    if (char === '(') parenDepth++;
    else if (char === ')') parenDepth = Math.max(0, parenDepth - 1);
    else if (char === '[') bracketDepth++;
    else if (char === ']') bracketDepth = Math.max(0, bracketDepth - 1);
    else if (char === '{') braceDepth++;
    else if (char === '}') braceDepth = Math.max(0, braceDepth - 1);

    if (char === delimiter && parenDepth === 0 && bracketDepth === 0 && braceDepth === 0) {
      if (current.trim()) parts.push(current.trim());
      current = '';
      continue;
    }

    current += char;
  }

  if (current.trim()) parts.push(current.trim());
  return parts;
}

function parseGapShorthand(value) {
  const parts = splitCssTokens(value);
  const r = {};
  if (parts.length === 1) { r.rowGap = responsiveValue(parts[0]); r.columnGap = responsiveValue(parts[0]); }
  else if (parts.length >= 2) { r.rowGap = responsiveValue(parts[0]); r.columnGap = responsiveValue(parts[1]); }
  return r;
}

function parseDeclarations(declarations) {
  const styleAttributes = {};
  const unsupportedProps = [];
  const cssProps = splitCssTopLevel(declarations, ';');

  cssProps.forEach(prop => {
    const colonIndex = prop.indexOf(':');
    if (colonIndex === -1) return;
    const property = prop.substring(0, colonIndex).trim();
    const value = prop.substring(colonIndex + 1).trim();
    if (!property || !value) return;
    const camel = toCamelCase(property);

    if (camel === 'padding') Object.assign(styleAttributes, parseSpacingShorthand(value, 'padding'));
    else if (camel === 'margin') Object.assign(styleAttributes, parseSpacingShorthand(value, 'margin'));
    else if (camel === 'gap') Object.assign(styleAttributes, parseGapShorthand(value));
    else if (SUPPORTED_CSS_PROPS.has(camel)) styleAttributes[camel] = responsiveValue(value);
    else unsupportedProps.push({ property, value });
  });

  let customCSS = '';
  if (unsupportedProps.length > 0) {
    const decl = unsupportedProps.map(p => `${p.property}:${p.value}`).join(';');
    customCSS = `{CURRENT}{${decl}}`;
  }
  return { styleAttributes, customCSS };
}

// Phase 1 deliberately resolves only unconditional author rules. Conditional
// at-rules, dynamic states, pseudo-elements and keyframes remain in the intact
// source stylesheet until their dedicated conversion phases.
const INHERITABLE_CSS_PROPERTIES = new Set([
  'azimuth','border-collapse','border-spacing','caption-side','color','cursor',
  'direction','empty-cells','font','font-family','font-feature-settings',
  'font-kerning','font-language-override','font-optical-sizing','font-size',
  'font-size-adjust','font-stretch','font-style','font-synthesis','font-variant',
  'font-variation-settings','font-weight','hyphens','image-rendering',
  'letter-spacing','line-height','list-style','list-style-image',
  'list-style-position','list-style-type','orphans','overflow-wrap','quotes',
  'ruby-align','ruby-position','speak','tab-size','text-align','text-indent',
  'text-justify','text-rendering','text-shadow','text-transform','visibility',
  'white-space','widows','word-break','word-spacing','word-wrap','writing-mode'
]);

const DEFERRED_NATIVE_PROPERTIES = new Set([
  'animation','animation-composition','animation-delay','animation-direction',
  'animation-duration','animation-fill-mode','animation-iteration-count',
  'animation-name','animation-play-state','animation-range','animation-timeline',
  'animation-timing-function','scroll-timeline','view-timeline'
]);

function skipCssTrivia(css, start) {
  let index = start;
  while (index < css.length) {
    if (/\s/.test(css[index])) { index++; continue; }
    if (css[index] === '/' && css[index + 1] === '*') {
      const end = css.indexOf('*/', index + 2);
      return end === -1 ? css.length : skipCssTrivia(css, end + 2);
    }
    break;
  }
  return index;
}

function findCssBoundary(css, start, targets) {
  let quote = '';
  let parenDepth = 0;
  let bracketDepth = 0;
  for (let index = start; index < css.length; index++) {
    const char = css[index];
    const next = css[index + 1];
    if (quote) {
      if (char === quote && css[index - 1] !== '\\') quote = '';
      continue;
    }
    if (char === '"' || char === "'") { quote = char; continue; }
    if (char === '/' && next === '*') {
      const end = css.indexOf('*/', index + 2);
      if (end === -1) return -1;
      index = end + 1;
      continue;
    }
    if (char === '(') parenDepth++;
    else if (char === ')') parenDepth = Math.max(0, parenDepth - 1);
    else if (char === '[') bracketDepth++;
    else if (char === ']') bracketDepth = Math.max(0, bracketDepth - 1);
    else if (parenDepth === 0 && bracketDepth === 0 && targets.includes(char)) return index;
  }
  return -1;
}

function findMatchingCssBrace(css, openIndex) {
  let depth = 1;
  let quote = '';
  for (let index = openIndex + 1; index < css.length; index++) {
    const char = css[index];
    const next = css[index + 1];
    if (quote) {
      if (char === quote && css[index - 1] !== '\\') quote = '';
      continue;
    }
    if (char === '"' || char === "'") { quote = char; continue; }
    if (char === '/' && next === '*') {
      const end = css.indexOf('*/', index + 2);
      if (end === -1) return css.length - 1;
      index = end + 1;
      continue;
    }
    if (char === '{') depth++;
    else if (char === '}' && --depth === 0) return index;
  }
  return css.length - 1;
}

function stripCssComments(value) {
  return value.replace(/\/\*[\s\S]*?\*\//g, ' ');
}

function parseDeclarationList(declarations) {
  const parsed = [];
  splitCssTopLevel(declarations, ';').forEach((raw, declarationOrder) => {
    const colonIndex = findCssBoundary(raw, 0, [':']);
    if (colonIndex === -1) return;
    const property = stripCssComments(raw.slice(0, colonIndex)).trim();
    let value = stripCssComments(raw.slice(colonIndex + 1)).trim();
    if (!property || !value) return;
    const importantMatch = value.match(/!\s*important\s*$/i);
    const important = Boolean(importantMatch);
    if (importantMatch) value = value.slice(0, importantMatch.index).trim();
    if (!value) return;
    parsed.push({
      property: property.startsWith('--') ? property : property.toLowerCase(),
      value,
      important,
      declarationOrder
    });
  });
  return parsed;
}

function readCssIdentifier(value, start) {
  let index = start;
  let identifier = '';
  while (index < value.length && /[a-zA-Z0-9_-]/.test(value[index])) {
    identifier += value[index++];
  }
  return { identifier, end: index };
}

function addSpecificity(left, right) {
  return [left[0] + right[0], left[1] + right[1], left[2] + right[2]];
}

function maxSpecificity(values) {
  return values.reduce((best, value) => compareSpecificity(value, best) > 0 ? value : best, [0, 0, 0]);
}

function compareSpecificity(left, right) {
  for (let index = 0; index < 3; index++) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

function splitComplexSelector(selector) {
  const compounds = [];
  const combinators = [];
  let current = '';
  let quote = '';
  let bracketDepth = 0;
  let parenDepth = 0;
  let pendingDescendant = false;

  function flushCompound() {
    if (!current.trim()) return;
    compounds.push(current.trim());
    current = '';
  }

  for (let index = 0; index < selector.length; index++) {
    const char = selector[index];
    if (quote) {
      current += char;
      if (char === quote && selector[index - 1] !== '\\') quote = '';
      continue;
    }
    if (char === '"' || char === "'") { quote = char; current += char; continue; }
    if (char === '[') bracketDepth++;
    else if (char === ']') bracketDepth = Math.max(0, bracketDepth - 1);
    else if (char === '(') parenDepth++;
    else if (char === ')') parenDepth = Math.max(0, parenDepth - 1);

    if (bracketDepth === 0 && parenDepth === 0 && /\s/.test(char)) {
      flushCompound();
      pendingDescendant = compounds.length > combinators.length;
      continue;
    }
    if (bracketDepth === 0 && parenDepth === 0 && (char === '>' || char === '+' || char === '~')) {
      flushCompound();
      if (compounds.length !== combinators.length + 1) return { supported: false, reason: 'malformed combinator' };
      combinators.push(char);
      pendingDescendant = false;
      continue;
    }
    if (pendingDescendant) {
      if (compounds.length === combinators.length + 1) combinators.push(' ');
      pendingDescendant = false;
    }
    current += char;
  }
  flushCompound();
  if (!compounds.length || combinators.length !== compounds.length - 1) {
    return { supported: false, reason: 'malformed selector' };
  }
  return { supported: true, compounds, combinators };
}

function parseAttributeSelector(source) {
  const value = source.trim();
  const match = value.match(/^([^\s~|^$*!=]+)\s*(?:([~|^$*]?=)\s*(?:"([^"]*)"|'([^']*)'|([^\s]+))\s*([isIS])?)?$/);
  if (!match) return null;
  return {
    name: match[1].toLowerCase(),
    operator: match[2] || '',
    value: match[3] != null ? match[3] : (match[4] != null ? match[4] : (match[5] || '')),
    insensitive: Boolean(match[6] && match[6].toLowerCase() === 'i')
  };
}

function findMatchingBracket(value, openIndex) {
  let quote = '';
  for (let index = openIndex + 1; index < value.length; index++) {
    const char = value[index];
    if (quote) {
      if (char === quote && value[index - 1] !== '\\') quote = '';
      continue;
    }
    if (char === '"' || char === "'") { quote = char; continue; }
    if (char === ']') return index;
  }
  return -1;
}

function parseNthExpression(value) {
  const normalized = value.replace(/\s+/g, '').toLowerCase();
  if (normalized === 'odd') return { a: 2, b: 1 };
  if (normalized === 'even') return { a: 2, b: 0 };
  if (/^[+-]?\d+$/.test(normalized)) return { a: 0, b: Number(normalized) };
  const match = normalized.match(/^([+-]?\d*)n([+-]\d+)?$/);
  if (!match) return null;
  let a = match[1];
  if (a === '' || a === '+') a = 1;
  else if (a === '-') a = -1;
  else a = Number(a);
  return { a, b: match[2] ? Number(match[2]) : 0 };
}

function parseCompoundSelector(compound) {
  const tests = [];
  let specificity = [0, 0, 0];
  let index = 0;
  let hasType = false;

  if (compound[index] === '*') { tests.push({ kind: 'universal' }); index++; hasType = true; }
  else if (/[a-zA-Z_-]/.test(compound[index] || '')) {
    const read = readCssIdentifier(compound, index);
    tests.push({ kind: 'tag', value: read.identifier.toLowerCase() });
    specificity[2]++;
    index = read.end;
    hasType = true;
  }

  while (index < compound.length) {
    const marker = compound[index];
    if (marker === '\\' || marker === '&' || marker === '|') return { supported: false, reason: 'escaped, nested or namespaced selector' };
    if (marker === '.' || marker === '#') {
      const read = readCssIdentifier(compound, index + 1);
      if (!read.identifier) return { supported: false, reason: 'invalid class or id selector' };
      tests.push({ kind: marker === '.' ? 'class' : 'id', value: read.identifier });
      specificity[marker === '#' ? 0 : 1]++;
      index = read.end;
      continue;
    }
    if (marker === '[') {
      const end = findMatchingBracket(compound, index);
      if (end === -1) return { supported: false, reason: 'unterminated attribute selector' };
      const attribute = parseAttributeSelector(compound.slice(index + 1, end));
      if (!attribute) return { supported: false, reason: 'unsupported attribute selector' };
      tests.push({ kind: 'attribute', value: attribute });
      specificity[1]++;
      index = end + 1;
      continue;
    }
    if (marker === ':') {
      if (compound[index + 1] === ':') return { supported: false, reason: 'pseudo-element' };
      const read = readCssIdentifier(compound, index + 1);
      if (!read.identifier) return { supported: false, reason: 'invalid pseudo-class' };
      const name = read.identifier.toLowerCase();
      index = read.end;
      let argument = null;
      if (compound[index] === '(') {
        const end = findMatchingParenthesis(compound, index);
        if (end === -1) return { supported: false, reason: 'unterminated pseudo-class' };
        argument = compound.slice(index + 1, end).trim();
        index = end + 1;
      }

      if (name === 'is' || name === 'not' || name === 'where') {
        if (argument == null) return { supported: false, reason: `:${name} requires arguments` };
        const selectors = splitCssTopLevel(argument, ',').map(parseSelector);
        if (!selectors.length || selectors.some(item => !item.supported)) {
          return { supported: false, reason: `unsupported selector inside :${name}()` };
        }
        tests.push({ kind: 'selector-list-pseudo', name, selectors });
        if (name !== 'where') specificity = addSpecificity(specificity, maxSpecificity(selectors.map(item => item.specificity)));
        continue;
      }

      const structural = new Set(['root','empty','first-child','last-child','only-child','first-of-type','last-of-type','only-of-type']);
      if (structural.has(name) && argument == null) {
        tests.push({ kind: 'structural-pseudo', name });
        specificity[1]++;
        continue;
      }
      if (['nth-child','nth-last-child','nth-of-type','nth-last-of-type'].includes(name)) {
        if (argument == null || /\bof\b/i.test(argument)) return { supported: false, reason: `unsupported :${name}() expression` };
        const nth = parseNthExpression(argument);
        if (!nth) return { supported: false, reason: `unsupported :${name}() expression` };
        tests.push({ kind: 'nth-pseudo', name, nth });
        specificity[1]++;
        continue;
      }
      return { supported: false, reason: `dynamic or unsupported pseudo-class :${name}` };
    }
    if (!hasType && /[a-zA-Z_-]/.test(marker)) {
      const read = readCssIdentifier(compound, index);
      tests.push({ kind: 'tag', value: read.identifier.toLowerCase() });
      specificity[2]++;
      index = read.end;
      hasType = true;
      continue;
    }
    return { supported: false, reason: `unsupported selector token ${marker}` };
  }
  return { supported: true, tests, specificity };
}

function findMatchingParenthesis(value, openIndex) {
  let depth = 1;
  let quote = '';
  for (let index = openIndex + 1; index < value.length; index++) {
    const char = value[index];
    if (quote) {
      if (char === quote && value[index - 1] !== '\\') quote = '';
      continue;
    }
    if (char === '"' || char === "'") { quote = char; continue; }
    if (char === '(') depth++;
    else if (char === ')' && --depth === 0) return index;
  }
  return -1;
}

function parseSelector(selector) {
  const complex = splitComplexSelector(stripCssComments(selector).trim());
  if (!complex.supported) return { supported: false, selector, reason: complex.reason };
  const compounds = complex.compounds.map(parseCompoundSelector);
  const failed = compounds.find(item => !item.supported);
  if (failed) return { supported: false, selector, reason: failed.reason };
  return {
    supported: true,
    selector,
    compounds,
    combinators: complex.combinators,
    specificity: compounds.reduce((sum, item) => addSpecificity(sum, item.specificity), [0, 0, 0])
  };
}

function parseNativeStateSelector(selectorText) {
  const trimmed = stripCssComments(selectorText).trim();
  const hoverMatches = trimmed.match(/:hover\b/g) || [];
  if (hoverMatches.length === 1 && /:hover\s*$/.test(trimmed) && !trimmed.includes('::')) {
    const baseSelector = parseSelector(trimmed.replace(/:hover\s*$/, ''));
    if (baseSelector.supported) {
      return {
        state: 'hover',
        selector: baseSelector,
        specificity: addSpecificity(baseSelector.specificity, [0, 1, 0])
      };
    }
  }
  return null;
}

function parseCss(cssText) {
  const result = {
    classes: {},
    allClasses: new Set(),
    nonClassCss: '',
    orderedNodes: [],
    ruleRecords: [],
    unsupportedSelectors: [],
    keyframes: new Map(),
    globalAtRules: [],
    mediaConditions: new Set()
  };
  let sourceOrder = 0;

  function parseList(source, context) {
    let index = 0;
    while ((index = skipCssTrivia(source, index)) < source.length) {
      const start = index;
      const boundary = findCssBoundary(source, index, ['{', ';']);
      if (boundary === -1) {
        const rawCss = source.slice(start).trim();
        if (rawCss) {
          const record = { kind: 'invalid', rawCss, sourceOrder: sourceOrder++, mediaCondition: context.mediaCondition || null };
          result.orderedNodes.push(record);
          result.globalAtRules.push(record);
        }
        break;
      }
      if (source[boundary] === ';') {
        const rawCss = source.slice(start, boundary + 1);
        const record = { kind: 'at-rule', rawCss, sourceOrder: sourceOrder++, mediaCondition: context.mediaCondition || null };
        result.orderedNodes.push(record);
        result.globalAtRules.push(record);
        result.ruleRecords.push({ kind: 'global', rawCss, sourceOrder: record.sourceOrder });
        result.nonClassCss += rawCss;
        index = boundary + 1;
        continue;
      }

      const close = findMatchingCssBrace(source, boundary);
      const prelude = stripCssComments(source.slice(start, boundary)).trim();
      const body = source.slice(boundary + 1, close);
      const rawCss = source.slice(start, Math.min(source.length, close + 1));
      index = close + 1;

      if (prelude.startsWith('@')) {
        const atMatch = prelude.match(/^@([a-zA-Z-]+)\s*([\s\S]*)$/);
        const atName = atMatch ? atMatch[1].toLowerCase() : '';
        const atValue = atMatch ? atMatch[2].trim() : '';
        const order = sourceOrder++;
        const record = { kind: 'at-rule', name: atName, value: atValue, body, rawCss, sourceOrder: order, mediaCondition: context.mediaCondition || null };
        result.orderedNodes.push(record);

        if (atName === 'media' && !context.mediaCondition) {
          result.mediaConditions.add(atValue);
          parseList(body, { mediaCondition: atValue });
        } else if (atName === 'keyframes' && !context.mediaCondition) {
          const name = atValue.split(/\s+/)[0];
          if (name) result.keyframes.set(name, { name, code: body.trim(), rawCss, sourceOrder: order });
        } else {
          result.globalAtRules.push(record);
          result.ruleRecords.push({ kind: 'global', rawCss, sourceOrder: order });
          result.nonClassCss += rawCss;
        }
        continue;
      }

      const order = sourceOrder++;
      const declarations = parseDeclarationList(body);
      const selectorTexts = splitCssTopLevel(prelude, ',');
      const selectors = selectorTexts.map(parseSelector);
      result.orderedNodes.push({
        kind: 'style', selectorText: prelude, selectors, declarations, rawCss,
        sourceOrder: order, mediaCondition: context.mediaCondition || null
      });

      selectorTexts.forEach((selectorText, selectorIndex) => {
        const selector = selectors[selectorIndex];
        const classMatches = selectorText.match(/\.([a-zA-Z_-][a-zA-Z0-9_-]*)/g) || [];
        classMatches.forEach(value => result.allClasses.add(value.slice(1)));
        const selectorRawCss = `${selectorText}{${body}}`;
        if (!selector.supported) {
          const nativeState = parseNativeStateSelector(selectorText);
          if (nativeState) {
            result.ruleRecords.push({
              kind: 'state', state: nativeState.state, selector: nativeState.selector,
              specificity: nativeState.specificity, declarations, rawCss: selectorRawCss,
              sourceOrder: order, mediaCondition: context.mediaCondition || null
            });
            return;
          }
          result.unsupportedSelectors.push({ selector: selectorText, reason: selector.reason, sourceOrder: order });
          result.ruleRecords.push({
            kind: 'unsupported-selector', selectorText, declarations,
            rawCss: selectorRawCss, sourceOrder: order,
            mediaCondition: context.mediaCondition || null
          });
          return;
        }
        result.ruleRecords.push({
          kind: 'matched', selector, declarations, rawCss: selectorRawCss,
          sourceOrder: order, mediaCondition: context.mediaCondition || null
        });
      });
    }
  }

  parseList(cssText, { mediaCondition: null });
  result.mediaSlotByCondition = buildMediaSlotMap(result.mediaConditions);
  return result;
}

function escRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function annotateHtmlTree(nodeList, parent) {
  for (const node of nodeList || []) {
    node.parent = parent || null;
    if (node.type === 'element' && node.children) annotateHtmlTree(node.children, node);
  }
}

function collectElementNodes(nodeList, output) {
  const elements = output || [];
  for (const node of nodeList || []) {
    if (node.type !== 'element') continue;
    elements.push(node);
    collectElementNodes(node.children, elements);
  }
  return elements;
}

function getElementParent(node) {
  let parent = node && node.parent;
  while (parent && parent.type !== 'element') parent = parent.parent;
  return parent || null;
}

function getElementSiblings(node) {
  const parent = getElementParent(node);
  if (!parent) return [node];
  return (parent.children || []).filter(child => child.type === 'element');
}

function getPreviousElementSibling(node) {
  const siblings = getElementSiblings(node);
  const index = siblings.indexOf(node);
  return index > 0 ? siblings[index - 1] : null;
}

function attributeSelectorMatches(node, selector) {
  const attributes = node.attributes || {};
  if (!Object.prototype.hasOwnProperty.call(attributes, selector.name)) return false;
  if (!selector.operator) return true;
  let actual = String(attributes[selector.name]);
  let expected = selector.value;
  if (selector.insensitive) {
    actual = actual.toLowerCase();
    expected = expected.toLowerCase();
  }
  if (selector.operator === '=') return actual === expected;
  if (selector.operator === '~=') return actual.split(/\s+/).includes(expected);
  if (selector.operator === '|=') return actual === expected || actual.startsWith(`${expected}-`);
  if (selector.operator === '^=') return actual.startsWith(expected);
  if (selector.operator === '$=') return actual.endsWith(expected);
  if (selector.operator === '*=') return actual.includes(expected);
  return false;
}

function nthExpressionMatches(position, expression) {
  if (position < 1) return false;
  if (expression.a === 0) return position === expression.b;
  const quotient = (position - expression.b) / expression.a;
  return Number.isInteger(quotient) && quotient >= 0;
}

function structuralPseudoMatches(node, name) {
  if (name === 'root') return !getElementParent(node);
  if (name === 'empty') {
    return !(node.children || []).some(child =>
      child.type === 'element' || (child.type === 'text' && child.content.length > 0)
    );
  }
  const siblings = getElementSiblings(node);
  const index = siblings.indexOf(node);
  const sameType = siblings.filter(sibling => sibling.tagName === node.tagName);
  const typeIndex = sameType.indexOf(node);
  if (name === 'first-child') return index === 0;
  if (name === 'last-child') return index === siblings.length - 1;
  if (name === 'only-child') return siblings.length === 1;
  if (name === 'first-of-type') return typeIndex === 0;
  if (name === 'last-of-type') return typeIndex === sameType.length - 1;
  if (name === 'only-of-type') return sameType.length === 1;
  return false;
}

function nthPseudoMatches(node, name, expression) {
  let siblings = getElementSiblings(node);
  if (name.includes('of-type')) siblings = siblings.filter(sibling => sibling.tagName === node.tagName);
  let position = siblings.indexOf(node) + 1;
  if (name.includes('last')) position = siblings.length - position + 1;
  return nthExpressionMatches(position, expression);
}

function compoundSelectorMatches(node, compound) {
  if (!node || node.type !== 'element') return false;
  for (const test of compound.tests) {
    if (test.kind === 'universal') continue;
    if (test.kind === 'tag' && node.tagName !== test.value) return false;
    if (test.kind === 'id' && (node.attributes.id || '') !== test.value) return false;
    if (test.kind === 'class') {
      const classes = (node.attributes.class || '').split(/\s+/).filter(Boolean);
      if (!classes.includes(test.value)) return false;
    }
    if (test.kind === 'attribute' && !attributeSelectorMatches(node, test.value)) return false;
    if (test.kind === 'structural-pseudo' && !structuralPseudoMatches(node, test.name)) return false;
    if (test.kind === 'nth-pseudo' && !nthPseudoMatches(node, test.name, test.nth)) return false;
    if (test.kind === 'selector-list-pseudo') {
      const anyMatch = test.selectors.some(selector => matchesParsedSelector(node, selector));
      if (test.name === 'not' ? anyMatch : !anyMatch) return false;
    }
  }
  return true;
}

function matchesParsedSelector(node, selector) {
  if (!selector || !selector.supported) return false;

  function matchAt(candidate, compoundIndex) {
    if (!compoundSelectorMatches(candidate, selector.compounds[compoundIndex])) return false;
    if (compoundIndex === 0) return true;
    const combinator = selector.combinators[compoundIndex - 1];
    if (combinator === '>') return matchAt(getElementParent(candidate), compoundIndex - 1);
    if (combinator === '+') return matchAt(getPreviousElementSibling(candidate), compoundIndex - 1);
    if (combinator === '~') {
      let sibling = getPreviousElementSibling(candidate);
      while (sibling) {
        if (matchAt(sibling, compoundIndex - 1)) return true;
        sibling = getPreviousElementSibling(sibling);
      }
      return false;
    }
    let ancestor = getElementParent(candidate);
    while (ancestor) {
      if (matchAt(ancestor, compoundIndex - 1)) return true;
      ancestor = getElementParent(ancestor);
    }
    return false;
  }

  return matchAt(node, selector.compounds.length - 1);
}

function cascadeCandidateWins(candidate, current) {
  if (!current) return true;
  if (candidate.important !== current.important) return candidate.important;
  if (candidate.inline !== current.inline) return candidate.inline;
  const specificityComparison = compareSpecificity(candidate.specificity, current.specificity);
  if (specificityComparison !== 0) return specificityComparison > 0;
  if (candidate.sourceOrder !== current.sourceOrder) return candidate.sourceOrder > current.sourceOrder;
  return candidate.declarationOrder >= current.declarationOrder;
}

function applyCascadeCandidate(map, declaration, context) {
  const candidate = {
    property: declaration.property,
    value: declaration.value,
    important: declaration.important,
    declarationOrder: declaration.declarationOrder,
    inline: Boolean(context.inline),
    specificity: context.specificity,
    sourceOrder: context.sourceOrder,
    inherited: false
  };
  if (cascadeCandidateWins(candidate, map.get(candidate.property))) map.set(candidate.property, candidate);
}

function isInheritableProperty(property) {
  return property.startsWith('--') || INHERITABLE_CSS_PROPERTIES.has(property);
}

function expandFourSideCascadeDeclaration(declaration, names) {
  const parts = splitCssTokens(declaration.value);
  if (parts.length < 1 || parts.length > 4) return [declaration];
  const values = parts.length === 1
    ? [parts[0], parts[0], parts[0], parts[0]]
    : parts.length === 2
      ? [parts[0], parts[1], parts[0], parts[1]]
      : parts.length === 3
        ? [parts[0], parts[1], parts[2], parts[1]]
        : parts;
  return names.map((property, index) => ({ ...declaration, property, value: values[index] }));
}

function expandCascadeDeclaration(declaration) {
  const property = declaration.property;
  if (property === 'margin' || property === 'padding') {
    return expandFourSideCascadeDeclaration(declaration, [
      `${property}-top`, `${property}-right`, `${property}-bottom`, `${property}-left`
    ]);
  }
  if (property === 'inset') {
    return expandFourSideCascadeDeclaration(declaration, ['top', 'right', 'bottom', 'left']);
  }
  if (property === 'gap') {
    const parts = splitCssTokens(declaration.value);
    if (parts.length === 1) {
      return [
        { ...declaration, property: 'row-gap', value: parts[0] },
        { ...declaration, property: 'column-gap', value: parts[0] }
      ];
    }
    if (parts.length === 2) {
      return [
        { ...declaration, property: 'row-gap', value: parts[0] },
        { ...declaration, property: 'column-gap', value: parts[1] }
      ];
    }
  }
  if (property === 'border-width' || property === 'border-style' || property === 'border-color') {
    const suffix = property.slice('border-'.length);
    return expandFourSideCascadeDeclaration(declaration, [
      `border-top-${suffix}`, `border-right-${suffix}`,
      `border-bottom-${suffix}`, `border-left-${suffix}`
    ]);
  }
  if (property === 'border-radius' && !declaration.value.includes('/')) {
    return expandFourSideCascadeDeclaration(declaration, [
      'border-top-left-radius', 'border-top-right-radius',
      'border-bottom-right-radius', 'border-bottom-left-radius'
    ]);
  }
  return [declaration];
}

// Breakpoints GreenShift renders for responsive slots 1-3.
const GREENSHIFT_SLOT_MAX_WIDTHS = [null, 991.98, 767.98, 575.98];

function mediaConditionMaxWidth(condition) {
  if (!condition || condition.includes(',')) return null;
  const normalized = condition.trim().toLowerCase();
  const match = normalized.match(/^(?:(?:only\s+)?(?:screen|all)\s+and\s+)?\(\s*max-width\s*:\s*([0-9]*\.?[0-9]+)px\s*\)$/);
  return match ? Number(match[1]) : null;
}

function mediaConditionToResponsiveSlot(condition) {
  const width = mediaConditionMaxWidth(condition);
  if (width == null) return null;
  // GreenShift's four-value model is desktop plus three descending device
  // bands. Only conventional, non-overlapping max-width bands are mapped;
  // unusual thresholds remain CSS so their semantics are not approximated.
  if (width >= 900 && width <= 1200) return 1;
  if (width >= 600 && width < 900) return 2;
  if (width >= 320 && width < 600) return 3;
  return null;
}

function buildMediaSlotMap(conditions) {
  const mapping = new Map();
  const conditionsBySlot = new Map();
  for (const condition of conditions || []) {
    const slot = mediaConditionToResponsiveSlot(condition);
    mapping.set(condition, slot);
    if (slot == null) continue;
    if (!conditionsBySlot.has(slot)) conditionsBySlot.set(slot, []);
    conditionsBySlot.get(slot).push(condition);
  }
  // Two different cutoffs in the same GreenShift band cannot both be
  // represented by a single slot without changing behavior. GreenShift's own
  // cutoff maps exactly, so it keeps the slot and the others stay CSS.
  for (const [slot, slotConditions] of conditionsBySlot) {
    if (slotConditions.length < 2) continue;
    const native = slotConditions.find(condition => mediaConditionMaxWidth(condition) === GREENSHIFT_SLOT_MAX_WIDTHS[slot]);
    slotConditions.forEach(condition => { if (condition !== native) mapping.set(condition, null); });
  }
  return mapping;
}

function slotsForMediaCondition(condition, mediaSlotByCondition) {
  if (!condition) return [0, 1, 2, 3];
  const start = mediaSlotByCondition && mediaSlotByCondition.has(condition)
    ? mediaSlotByCondition.get(condition)
    : mediaConditionToResponsiveSlot(condition);
  if (start == null) return [];
  return Array.from({ length: 4 - start }, (_, index) => start + index);
}

function createNodeSlotMaps(elements) {
  return Array.from({ length: 4 }, () => new Map(elements.map(node => [node, new Map()])));
}

function buildCssCascade(rootNodes, parsedCss) {
  const elements = collectElementNodes(rootNodes, []);
  const specifiedByNodeBySlot = createNodeSlotMaps(elements);
  const matchedRulesByNode = new Map(elements.map(node => [node, []]));
  const hoverRules = [];
  const hoverPropertiesByNode = new Map(elements.map(node => [node, new Set()]));

  for (const rule of parsedCss.ruleRecords || []) {
    if ((rule.kind !== 'matched' && rule.kind !== 'state') || !rule.selector || !rule.selector.supported) continue;
    const slots = slotsForMediaCondition(rule.mediaCondition, parsedCss.mediaSlotByCondition);
    if (!slots.length) continue;
    for (const node of elements) {
      if (!matchesParsedSelector(node, rule.selector)) continue;
      matchedRulesByNode.get(node).push(rule);
      if (rule.kind === 'state') {
        hoverRules.push({ rule, node, slots });
        for (const declaration of rule.declarations) {
          for (const expanded of expandCascadeDeclaration(declaration)) {
            hoverPropertiesByNode.get(node).add(expanded.property);
          }
        }
        continue;
      }
      for (const slot of slots) {
        const target = specifiedByNodeBySlot[slot].get(node);
        for (const declaration of rule.declarations) {
          for (const expanded of expandCascadeDeclaration(declaration)) {
            applyCascadeCandidate(target, expanded, {
              inline: false,
              specificity: rule.selector.specificity,
              sourceOrder: rule.sourceOrder
            });
          }
        }
      }
    }
  }

  for (const node of elements) {
    const inlineStyle = node.attributes && node.attributes.style;
    if (!inlineStyle) continue;
    for (let slot = 0; slot < 4; slot++) {
      const target = specifiedByNodeBySlot[slot].get(node);
      for (const declaration of parseDeclarationList(inlineStyle)) {
        for (const expanded of expandCascadeDeclaration(declaration)) {
          applyCascadeCandidate(target, expanded, {
            inline: true,
            specificity: [0, 0, 0],
            sourceOrder: Number.MAX_SAFE_INTEGER
          });
        }
      }
    }
  }

  const hoverSpecifiedByNodeBySlot = specifiedByNodeBySlot.map(slotMap => {
    const cloned = new Map();
    for (const [node, declarations] of slotMap) cloned.set(node, new Map(declarations));
    return cloned;
  });
  for (const entry of hoverRules) {
    for (const slot of entry.slots) {
      const target = hoverSpecifiedByNodeBySlot[slot].get(entry.node);
      for (const declaration of entry.rule.declarations) {
        for (const expanded of expandCascadeDeclaration(declaration)) {
          applyCascadeCandidate(target, expanded, {
            inline: false,
            specificity: entry.rule.specificity,
            sourceOrder: entry.rule.sourceOrder
          });
        }
      }
    }
  }

  function resolveSlot(slotMap) {
    const resolvedByNode = new Map();
    function resolveNode(node) {
      if (resolvedByNode.has(node)) return resolvedByNode.get(node);
      const parent = getElementParent(node);
      const parentResolved = parent ? resolveNode(parent) : new Map();
      const resolved = new Map();
      for (const [property, candidate] of parentResolved) {
        if (isInheritableProperty(property)) resolved.set(property, { ...candidate, inherited: true });
      }
      for (const [property, candidate] of slotMap.get(node) || []) {
        if (candidate.value === 'inherit' || (candidate.value === 'unset' && isInheritableProperty(property))) {
          if (parentResolved.has(property)) resolved.set(property, { ...parentResolved.get(property), inherited: true });
          else resolved.delete(property);
        } else if (candidate.value === 'unset') {
          resolved.delete(property);
        } else {
          resolved.set(property, candidate);
        }
      }
      resolvedByNode.set(node, resolved);
      return resolved;
    }
    elements.forEach(resolveNode);
    return resolvedByNode;
  }

  const resolvedByNodeBySlot = specifiedByNodeBySlot.map(resolveSlot);
  const hoverResolvedByNodeBySlot = hoverSpecifiedByNodeBySlot.map(resolveSlot);
  return {
    elements,
    specifiedByNode: specifiedByNodeBySlot[0],
    resolvedByNode: resolvedByNodeBySlot[0],
    specifiedByNodeBySlot,
    resolvedByNodeBySlot,
    hoverSpecifiedByNodeBySlot,
    hoverResolvedByNodeBySlot,
    hoverPropertiesByNode,
    matchedRulesByNode
  };
}

function responsiveValues(values) {
  if (values.every(value => value === values[0])) return [values[0]];
  return values;
}

function isNativeStyleProperty(property) {
  if (!property || property.startsWith('--')) return false;
  return SUPPORTED_CSS_PROPS.has(toCamelCase(property));
}

function declarationsToNativeStyleAttributes(cascade, node, allowedAnimationProperties) {
  const styleAttributes = {};
  if (!cascade || !node) return styleAttributes;
  const properties = new Set();
  for (const slotMap of cascade.specifiedByNodeBySlot) {
    for (const property of (slotMap.get(node) || new Map()).keys()) properties.add(property);
  }
  for (const property of properties) {
    if (!isNativeStyleProperty(property)) continue;
    if (DEFERRED_NATIVE_PROPERTIES.has(property) && !(allowedAnimationProperties && allowedAnimationProperties.has(property))) continue;
    const values = cascade.specifiedByNodeBySlot.map(slotMap => {
      const candidate = slotMap.get(node) && slotMap.get(node).get(property);
      return candidate ? candidate.value : null;
    });
    const camel = toCamelCase(property);
    styleAttributes[camel] = responsiveValues(values);
  }

  const hoverProperties = cascade.hoverPropertiesByNode.get(node) || new Set();
  for (const property of hoverProperties) {
    if (!isNativeStyleProperty(property) || DEFERRED_NATIVE_PROPERTIES.has(property)) continue;
    const baseValues = cascade.specifiedByNodeBySlot.map(slotMap => {
      const candidate = slotMap.get(node) && slotMap.get(node).get(property);
      return candidate ? candidate.value : null;
    });
    const hoverValues = cascade.hoverSpecifiedByNodeBySlot.map(slotMap => {
      const candidate = slotMap.get(node) && slotMap.get(node).get(property);
      return candidate ? candidate.value : null;
    });
    if (hoverValues.every((value, index) => value === baseValues[index])) continue;
    styleAttributes[`${toCamelCase(property)}_hover`] = responsiveValues(hoverValues);
  }

  function collapseEquivalentSides(target, shorthand, sides) {
    if (!sides.every(side => Object.prototype.hasOwnProperty.call(styleAttributes, side))) return;
    const first = JSON.stringify(styleAttributes[sides[0]]);
    if (!sides.every(side => JSON.stringify(styleAttributes[side]) === first)) return;
    target[shorthand] = styleAttributes[sides[0]];
    sides.forEach(side => delete target[side]);
  }
  collapseEquivalentSides(styleAttributes, 'inset', ['top', 'right', 'bottom', 'left']);
  collapseEquivalentSides(styleAttributes, 'borderRadius', [
    'borderTopLeftRadius','borderTopRightRadius','borderBottomRightRadius','borderBottomLeftRadius'
  ]);
  collapseEquivalentSides(styleAttributes, 'borderWidth', [
    'borderTopWidth','borderRightWidth','borderBottomWidth','borderLeftWidth'
  ]);
  collapseEquivalentSides(styleAttributes, 'borderStyle', [
    'borderTopStyle','borderRightStyle','borderBottomStyle','borderLeftStyle'
  ]);
  collapseEquivalentSides(styleAttributes, 'borderColor', [
    'borderTopColor','borderRightColor','borderBottomColor','borderLeftColor'
  ]);
  return styleAttributes;
}

function isAnimationProperty(property) {
  return DEFERRED_NATIVE_PROPERTIES.has(property);
}

function splitAnimationList(value) {
  return splitCssTopLevel(value, ',').map(part => part.trim()).filter(Boolean);
}

function extractAnimationNames(property, value) {
  if (!value || /\bvar\s*\(/i.test(value)) return null;
  if (property === 'animation-name') {
    const names = splitAnimationList(value).map(name => name.replace(/^['"]|['"]$/g, ''));
    return names.every(name => /^[a-zA-Z_][a-zA-Z0-9_-]*$/.test(name) || name === 'none') ? names : null;
  }
  if (property !== 'animation') return [];
  const ignoredKeywords = new Set([
    'none','infinite','normal','reverse','alternate','alternate-reverse','forwards',
    'backwards','both','running','paused','ease','ease-in','ease-out','ease-in-out',
    'linear','step-start','step-end','initial','inherit','unset','revert','revert-layer'
  ]);
  const names = [];
  for (const animation of splitAnimationList(value)) {
    const candidates = splitCssTokens(animation).filter(token => {
      const lower = token.toLowerCase();
      if (ignoredKeywords.has(lower)) return false;
      if (/^[+-]?(?:\d*\.)?\d+m?s$/i.test(token)) return false;
      if (/^[+-]?(?:\d*\.)?\d+$/.test(token)) return false;
      if (/^(?:cubic-bezier|steps|linear)\(/i.test(token)) return false;
      if (/^(?:scroll|view)\(/i.test(token)) return false;
      return true;
    });
    if (candidates.length > 1) return null;
    names.push(candidates.length ? candidates[0].replace(/^['"]|['"]$/g, '') : 'none');
  }
  return names;
}

function determineAnimationPlan(cascade, parsedCss) {
  const allowedPropertiesByNode = new Map();
  const keyframesByNode = new Map();
  const consumedKeyframeNames = new Set();
  for (const node of cascade.elements) {
    const animationProperties = new Set();
    for (const slotMap of cascade.specifiedByNodeBySlot) {
      for (const property of (slotMap.get(node) || new Map()).keys()) {
        if (isAnimationProperty(property)) animationProperties.add(property);
      }
    }
    if (!animationProperties.size) continue;
    const referencedNames = new Set();
    let safe = true;
    for (const property of animationProperties) {
      if (property !== 'animation' && property !== 'animation-name') continue;
      for (const slotMap of cascade.specifiedByNodeBySlot) {
        const candidate = slotMap.get(node) && slotMap.get(node).get(property);
        if (!candidate) continue;
        const names = extractAnimationNames(property, candidate.value);
        if (names == null) { safe = false; break; }
        names.filter(name => name !== 'none').forEach(name => referencedNames.add(name));
      }
      if (!safe) break;
    }
    if (!animationProperties.has('animation') && !animationProperties.has('animation-name')) safe = false;
    if (safe && Array.from(referencedNames).some(name => !parsedCss.keyframes.has(name))) safe = false;
    if (!safe) continue;
    allowedPropertiesByNode.set(node, animationProperties);
    const definitions = Array.from(referencedNames).map(name => {
      consumedKeyframeNames.add(name);
      const definition = parsedCss.keyframes.get(name);
      return { name: definition.name, code: definition.code };
    });
    if (definitions.length) keyframesByNode.set(node, definitions);
  }
  return { allowedPropertiesByNode, keyframesByNode, consumedKeyframeNames };
}

function isConvertibleCssOwner(node) {
  return Boolean(
    node && node.type === 'element' &&
    !SKIP_TAGS.has(node.tagName) &&
    node.tagName !== 'html' && node.tagName !== 'body' &&
    node.tagName !== 'br' && node.tagName !== 'hr' &&
    !node.attributes['data-gl-query-arguments']
  );
}

function joinComplexSelector(compounds, combinators) {
  let output = compounds[0] || '';
  for (let index = 1; index < compounds.length; index++) {
    const combinator = combinators[index - 1];
    output += combinator === ' ' ? ` ${compounds[index]}` : `${combinator}${compounds[index]}`;
  }
  return output;
}

function stripResidualOnlyPseudos(compound) {
  let output = compound.replace(/::[a-zA-Z-]+(?:\([^)]*\))?/g, '');
  output = output.replace(/:(?:hover|focus-visible|focus-within|focus|active|visited|target|checked|disabled|enabled|link|any-link)\b(?:\([^)]*\))?/g, '');
  return output.trim();
}

function localizeSelector(selectorText, elements) {
  const complex = splitComplexSelector(stripCssComments(selectorText).trim());
  if (!complex.supported) return null;
  const sanitized = complex.compounds.map(stripResidualOnlyPseudos);
  let preferredOwnerIndex = sanitized.length - 1;
  while (preferredOwnerIndex >= 0 && !sanitized[preferredOwnerIndex]) preferredOwnerIndex--;
  // Universal descendant rules are better owned by their nearest explicit
  // ancestor. This keeps resets and reduced-motion selectors on one logical
  // container instead of copying the same CSS to every descendant block.
  if (preferredOwnerIndex > 0 && sanitized[preferredOwnerIndex] === '*') {
    let explicitAncestor = preferredOwnerIndex - 1;
    while (explicitAncestor >= 0 && (!sanitized[explicitAncestor] || sanitized[explicitAncestor] === '*')) explicitAncestor--;
    if (explicitAncestor >= 0) preferredOwnerIndex = explicitAncestor;
  }
  if (preferredOwnerIndex < 0) return null;

  function ownerSelectorCandidates(index) {
    const candidates = [];
    const prefix = joinComplexSelector(sanitized.slice(0, index + 1), complex.combinators.slice(0, index));
    if (prefix) candidates.push(prefix);
    const compound = sanitized[index];
    if (compound && !candidates.includes(compound)) candidates.push(compound);
    const idsAndClasses = compound ? compound.match(/[#.][a-zA-Z_-][a-zA-Z0-9_-]*/g) || [] : [];
    idsAndClasses.forEach(candidate => { if (!candidates.includes(candidate)) candidates.push(candidate); });
    return candidates;
  }

  for (let ownerIndex = preferredOwnerIndex; ownerIndex >= 0; ownerIndex--) {
    if (!sanitized[ownerIndex] || sanitized[ownerIndex] === '*') continue;
    for (const candidateText of ownerSelectorCandidates(ownerIndex)) {
      const ownerSelector = parseSelector(candidateText);
      if (!ownerSelector.supported) continue;
      const owners = elements.filter(node => isConvertibleCssOwner(node) && matchesParsedSelector(node, ownerSelector));
      if (!owners.length) continue;
      const localizedCompounds = complex.compounds.slice();
      const originalOwner = localizedCompounds[ownerIndex];
      localizedCompounds[ownerIndex] = `{CURRENT}${originalOwner === '*' ? '' : originalOwner}`;
      return { owners, selector: joinComplexSelector(localizedCompounds, complex.combinators) };
    }
  }

  // SVG descendants are intentionally opaque in the HTML parser. A selector
  // whose class/id occurs inside raw SVG markup can still be scoped safely to
  // that SVG block without pretending the inner path is a separate block.
  const selectorHooks = selectorText.match(/[#.]([a-zA-Z_-][a-zA-Z0-9_-]*)/g) || [];
  if (selectorHooks.length) {
    const svgOwners = elements.filter(node =>
      isConvertibleCssOwner(node) && node.tagName === 'svg' &&
      selectorHooks.some(hook => (node.outerHTML || '').includes(hook.slice(1)))
    );
    if (svgOwners.length) return { owners: svgOwners, selector: `{CURRENT} ${selectorText}` };
  }
  return null;
}

function declarationText(declarations) {
  return declarations.map(declaration =>
    `${declaration.property}:${declaration.value}${declaration.important ? '!important' : ''}`
  ).join(';');
}

function wrapMediaCss(css, mediaCondition) {
  return mediaCondition ? `@media ${mediaCondition}{${css}}` : css;
}

// Typography that the GreenShift panel should show on the block that actually
// renders the text, instead of on an ancestor it is inherited from.
const TEXT_TYPOGRAPHY_PROPERTIES = [
  'font-size','line-height','font-weight','font-style','color','letter-spacing','text-transform'
];

function hasRenderedText(node) {
  return (node.children || []).some(child => child.type === 'text' && child.content.trim());
}

// Moves inherited typography from containers onto the text blocks, so every
// text element carries its own editable values. A property stays on its
// container when a :hover rule or a script changes it there, because moving
// it would stop the change from reaching the text.
function distributeTypographyToTextBlocks(cascade, bodyElements, nativeStylesByNode, scriptTargets) {
  function holdsProperty(node, property) {
    return scriptTargets.has(node) ||
      (cascade.hoverPropertiesByNode.get(node) || new Set()).has(property);
  }
  function heldAbove(node, property, includeSelf) {
    let current = includeSelf ? node : getElementParent(node);
    while (current) {
      if (holdsProperty(current, property)) return true;
      current = getElementParent(current);
    }
    return false;
  }
  function resolvedValues(node, property) {
    const values = cascade.resolvedByNodeBySlot.map(slotMap => {
      const candidate = slotMap.get(node) && slotMap.get(node).get(property);
      return candidate ? candidate.value : null;
    });
    return values.some(value => value != null) ? responsiveValues(values) : null;
  }
  function assign(target, sourceElement, isOwnBlock) {
    for (const property of TEXT_TYPOGRAPHY_PROPERTIES) {
      if (!isNativeStyleProperty(property) || heldAbove(sourceElement, property, !isOwnBlock)) continue;
      const values = resolvedValues(sourceElement, property);
      if (values) target[toCamelCase(property)] = values;
    }
  }

  for (const node of cascade.elements) {
    if (!bodyElements.has(node)) continue;
    if (node.tagName === 'svg') {
      // Icons paint with currentColor, so they need the color that is being
      // removed from their container.
      const values = heldAbove(node, 'color', false) ? null : resolvedValues(node, 'color');
      if (values) nativeStylesByNode.set(node, { ...(nativeStylesByNode.get(node) || {}), color: values });
      continue;
    }
    if (hasElementChildren(node)) {
      // Container: its loose text becomes separate span blocks, which take the
      // container's values. The container itself keeps only what is held.
      for (const child of node.children) {
        if (child.type !== 'text' || !child.content.trim()) continue;
        const textStyles = {};
        assign(textStyles, node, false);
        if (Object.keys(textStyles).length) nativeStylesByNode.set(child, textStyles);
      }
      const styles = nativeStylesByNode.get(node);
      if (!styles) continue;
      for (const property of TEXT_TYPOGRAPHY_PROPERTIES) {
        if (!heldAbove(node, property, true)) delete styles[toCamelCase(property)];
      }
      if (!Object.keys(styles).length) nativeStylesByNode.delete(node);
    } else if (hasRenderedText(node)) {
      const styles = nativeStylesByNode.get(node) || {};
      assign(styles, node, true);
      if (Object.keys(styles).length) nativeStylesByNode.set(node, styles);
    }
  }
}

function buildNativeStylingPlan(bodyNodes, parsedCss, cascade, scriptTargets) {
  const animationPlan = determineAnimationPlan(cascade, parsedCss);
  const nativeStylesByNode = new Map();
  const residualEntriesByNode = new Map();
  const globalResidualEntries = [];
  const globallyRequiredKeyframes = new Set();
  let residualSequence = 0;
  const bodyElements = new Set(collectElementNodes(bodyNodes, []).filter(isConvertibleCssOwner));

  function addLocalResidual(node, css, sourceOrder) {
    if (!css || !bodyElements.has(node)) return;
    if (!residualEntriesByNode.has(node)) residualEntriesByNode.set(node, []);
    residualEntriesByNode.get(node).push({ css, sourceOrder, sequence: residualSequence++ });
  }

  function addGlobalResidual(css, sourceOrder) {
    if (css) globalResidualEntries.push({ css, sourceOrder, sequence: residualSequence++ });
  }

  function animationNamesFromDeclarations(declarations) {
    const names = new Set();
    for (const declaration of declarations || []) {
      if (declaration.property !== 'animation' && declaration.property !== 'animation-name') continue;
      const extracted = extractAnimationNames(declaration.property, declaration.value);
      if (extracted) extracted.filter(name => name !== 'none').forEach(name => names.add(name));
    }
    return names;
  }

  function attachResidualKeyframes(owners, declarations) {
    const names = animationNamesFromDeclarations(declarations);
    for (const node of owners) {
      if (!bodyElements.has(node)) continue;
      const definitions = [];
      for (const name of names) {
        const definition = parsedCss.keyframes.get(name);
        if (!definition) continue;
        definitions.push({ name: definition.name, code: definition.code });
        animationPlan.consumedKeyframeNames.add(name);
      }
      if (!definitions.length) continue;
      const nativeStyles = nativeStylesByNode.get(node) || {};
      const existing = nativeStyles.animation_keyframes_Extra || [];
      const byName = new Map(existing.map(definition => [definition.name, definition]));
      definitions.forEach(definition => byName.set(definition.name, definition));
      nativeStyles.animation_keyframes_Extra = Array.from(byName.values());
      nativeStylesByNode.set(node, nativeStyles);
    }
  }

  function requireGlobalKeyframes(declarations) {
    animationNamesFromDeclarations(declarations).forEach(name => globallyRequiredKeyframes.add(name));
  }

  for (const node of cascade.elements) {
    if (!bodyElements.has(node)) continue;
    const nativeStyles = declarationsToNativeStyleAttributes(
      cascade,
      node,
      animationPlan.allowedPropertiesByNode.get(node)
    );
    const keyframes = animationPlan.keyframesByNode.get(node);
    if (keyframes && keyframes.length) nativeStyles.animation_keyframes_Extra = keyframes;
    if (Object.keys(nativeStyles).length) nativeStylesByNode.set(node, nativeStyles);
  }
  distributeTypographyToTextBlocks(cascade, bodyElements, nativeStylesByNode, scriptTargets || new Set());

  for (const rule of parsedCss.ruleRecords) {
    if (rule.kind === 'global') continue;
    const mappedSlots = slotsForMediaCondition(rule.mediaCondition, parsedCss.mediaSlotByCondition);
    const mediaIsMapped = !rule.mediaCondition || mappedSlots.length > 0;

    if (rule.kind === 'unsupported-selector') {
      const localized = localizeSelector(rule.selectorText, cascade.elements);
      if (localized) {
        const css = wrapMediaCss(`${localized.selector}{${declarationText(rule.declarations)}}`, rule.mediaCondition);
        localized.owners.forEach(node => addLocalResidual(node, css, rule.sourceOrder));
        attachResidualKeyframes(localized.owners, rule.declarations);
      } else {
        addGlobalResidual(wrapMediaCss(rule.rawCss, rule.mediaCondition), rule.sourceOrder);
        requireGlobalKeyframes(rule.declarations);
      }
      continue;
    }

    if (rule.kind !== 'matched' && rule.kind !== 'state') continue;
    const matchedNodes = cascade.elements.filter(node => matchesParsedSelector(node, rule.selector));
    const renderedMatches = matchedNodes.filter(node => bodyElements.has(node));
    if (!renderedMatches.length) {
      const localized = localizeSelector(rule.selector.selector, cascade.elements);
      if (localized) {
        const css = wrapMediaCss(`${localized.selector}{${declarationText(rule.declarations)}}`, rule.mediaCondition);
        const localOwners = localized.owners.filter(node => bodyElements.has(node));
        if (localOwners.length) {
          localOwners.forEach(node => addLocalResidual(node, css, rule.sourceOrder));
          attachResidualKeyframes(localOwners, rule.declarations);
        } else {
          addGlobalResidual(wrapMediaCss(rule.rawCss, rule.mediaCondition), rule.sourceOrder);
          requireGlobalKeyframes(rule.declarations);
        }
      } else {
        addGlobalResidual(wrapMediaCss(rule.rawCss, rule.mediaCondition), rule.sourceOrder);
        requireGlobalKeyframes(rule.declarations);
      }
      continue;
    }

    let residualDeclarations;
    if (!mediaIsMapped) {
      residualDeclarations = rule.declarations;
    } else {
      residualDeclarations = rule.declarations.filter(declaration => {
        if (!isNativeStyleProperty(declaration.property)) return true;
        if (rule.kind === 'state' && isAnimationProperty(declaration.property)) return true;
        if (isAnimationProperty(declaration.property)) {
          return !renderedMatches.every(node =>
            animationPlan.allowedPropertiesByNode.get(node) &&
            animationPlan.allowedPropertiesByNode.get(node).has(declaration.property)
          );
        }
        return false;
      });
    }
    if (!residualDeclarations.length) continue;
    const localized = localizeSelector(rule.selector.selector, cascade.elements);
    if (!localized) {
      addGlobalResidual(
        wrapMediaCss(`${rule.selector.selector}{${declarationText(residualDeclarations)}}`, rule.mediaCondition),
        rule.sourceOrder
      );
      requireGlobalKeyframes(residualDeclarations);
      continue;
    }
    const css = wrapMediaCss(`${localized.selector}{${declarationText(residualDeclarations)}}`, rule.mediaCondition);
    const localOwners = localized.owners.filter(node => bodyElements.has(node));
    localOwners.forEach(node => addLocalResidual(node, css, rule.sourceOrder));
    attachResidualKeyframes(localOwners, residualDeclarations);
  }

  for (const atRule of parsedCss.globalAtRules) {
    if (atRule.name === 'keyframes') continue;
    addGlobalResidual(wrapMediaCss(atRule.rawCss, atRule.mediaCondition), atRule.sourceOrder);
  }
  for (const [name, keyframe] of parsedCss.keyframes) {
    if (!animationPlan.consumedKeyframeNames.has(name) || globallyRequiredKeyframes.has(name)) {
      addGlobalResidual(keyframe.rawCss, keyframe.sourceOrder);
    }
  }

  function orderedCss(entries) {
    return (entries || [])
      .sort((left, right) => left.sourceOrder - right.sourceOrder || left.sequence - right.sequence)
      .map(entry => entry.css)
      .filter((css, index, values) => index === 0 || css !== values[index - 1])
      .join('\n');
  }
  const residualCssByNode = new Map();
  for (const [node, entries] of residualEntriesByNode) residualCssByNode.set(node, orderedCss(entries));
  return {
    nativeStylesByNode,
    residualCssByNode,
    globalResidualCss: orderedCss(globalResidualEntries),
    animationPlan
  };
}

// ─── HTML Node to Block Conversion ──────────────────────────────────────────

const INNER_TAGS = new Set(['div','section','article','header','footer','nav','aside','main','ul','ol','li','table','thead','tbody','tfoot','tr','form','fieldset','figure','figcaption','details','summary','dialog','menu']);
const TEXT_TAGS = new Set(['p','h1','h2','h3','h4','h5','h6','span','a','strong','em','b','i','u','small','mark','del','ins','sub','sup','label','legend','th','td','dt','dd','caption','blockquote','cite','code','pre','abbr','time','address','button']);

function getTypeFromTag(tag) {
  if (INNER_TAGS.has(tag)) return 'inner';
  if (TEXT_TAGS.has(tag)) return 'text';
  if (tag === 'img') return 'image';
  if (tag === 'video') return 'video';
  if (tag === 'audio') return 'audio';
  if (tag === 'iframe') return 'iframe';
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return 'form';
  return 'inner';
}

function getDirectTextContent(node) {
  if (!node.children) return '';
  return node.children
    .filter(c => c.type === 'text')
    .map(c => c.content)
    .join(' ')
    .trim();
}

function hasElementChildren(node) {
  if (!node.children) return false;
  return node.children.some(c => c.type === 'element');
}

function hasElementChildrenIn(children) {
  return children.some(child => child.type === 'element');
}

function getDirectTextContentFromChildren(children) {
  return children
    .filter(child => child.type === 'text')
    .map(child => child.content)
    .join(' ')
    .trim();
}

function getRenderableChildren(node, dynamicTextValue) {
  const children = Array.isArray(node.children) ? node.children : [];
  if (!dynamicTextValue) return children;

  const rewrittenChildren = [];
  let textReplaced = false;

  for (const child of children) {
    if (child.type === 'text') {
      if (!textReplaced) {
        rewrittenChildren.push({ type: 'text', content: dynamicTextValue });
        textReplaced = true;
      }
      continue;
    }
    rewrittenChildren.push(child);
  }

  if (!textReplaced) {
    rewrittenChildren.unshift({ type: 'text', content: dynamicTextValue });
  }

  return rewrittenChildren;
}

function parseJsonAttribute(value) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch (error) {
    return null;
  }
}

// Block ids key site-wide data such as the gspb_block_js option, so they must
// not repeat across pages. Random 7-hex ids match GreenShift's own format.
const generatedBlockIds = new Set();

function resetGeneratedBlockIds() {
  generatedBlockIds.clear();
}

function generateGsBlockId() {
  let id;
  do {
    id = `gsbp-${require('crypto').randomBytes(4).toString('hex').slice(0, 7)}`;
  } while (generatedBlockIds.has(id));
  generatedBlockIds.add(id);
  return id;
}

function collectRenderableClassNames(nodeList, classNames) {
  for (const node of nodeList) {
    if (node.type !== 'element' || SKIP_TAGS.has(node.tagName)) continue;
    if (!node.attributes['data-gl-query-arguments']) {
      const cls = node.attributes['class'];
      if (cls) cls.split(/\s+/).filter(Boolean).forEach(className => classNames.add(className));
    }
    if (node.children) collectRenderableClassNames(node.children, classNames);
  }
  return classNames;
}

function findFirstBlockHost(nodeList) {
  for (const node of nodeList) {
    if (node.type === 'text' && node.content.trim()) return node;
    if (node.type !== 'element' || SKIP_TAGS.has(node.tagName) || node.tagName === 'br' || node.tagName === 'hr') continue;
    if (node.attributes['data-gl-query-arguments']) {
      const childHost = findFirstBlockHost(node.children || []);
      if (childHost) return childHost;
      continue;
    }
    return node;
  }
  return null;
}

function extractJavaScriptSelectors(script) {
  const selectors = [];
  const selectorCall = /\b(?:querySelectorAll|querySelector|closest|matches)\s*\(\s*(['"`])([\s\S]*?)\1\s*\)/g;
  let match;
  while ((match = selectorCall.exec(script)) !== null) {
    if (!match[2].includes('${')) selectors.push(match[2]);
  }
  const idCall = /\bgetElementById\s*\(\s*(['"])([^'"]+)\1\s*\)/g;
  while ((match = idCall.exec(script)) !== null) selectors.push(`#${match[2]}`);
  const classCall = /\bgetElementsByClassName\s*\(\s*(['"])([^'"]+)\1\s*\)/g;
  while ((match = classCall.exec(script)) !== null) {
    match[2].split(/\s+/).filter(Boolean).forEach(className => selectors.push(`.${className}`));
  }
  return selectors;
}

function extractJavaScriptClassDependencies(script, selectors) {
  const classes = new Set();
  for (const selector of selectors) {
    const matches = selector.match(/\.([a-zA-Z_-][a-zA-Z0-9_-]*)/g) || [];
    matches.forEach(value => classes.add(value.slice(1)));
  }
  const classListCall = /\.classList\.(?:add|remove|toggle|contains|replace)\s*\(([^)]*)\)/g;
  let match;
  while ((match = classListCall.exec(script)) !== null) {
    const strings = match[1].match(/(['"])([^'"]+)\1/g) || [];
    strings.forEach(value => value.slice(1, -1).split(/\s+/).filter(Boolean).forEach(className => classes.add(className)));
  }
  return classes;
}

function lowestCommonElementAncestor(nodes) {
  if (!nodes.length) return null;
  const firstAncestors = [];
  let current = nodes[0];
  while (current) {
    if (current.type === 'element') firstAncestors.push(current);
    current = current.parent;
  }
  return firstAncestors.find(candidate => nodes.every(node => {
    let ancestor = node;
    while (ancestor) {
      if (ancestor === candidate) return true;
      ancestor = ancestor.parent;
    }
    return false;
  })) || null;
}

function findJavaScriptTargets(selectors, elements) {
  const targets = [];
  for (const selectorText of selectors) {
    for (const selectorPart of splitCssTopLevel(selectorText, ',')) {
      const selector = parseSelector(selectorPart);
      if (!selector.supported) continue;
      for (const node of elements) {
        if (isConvertibleCssOwner(node) && matchesParsedSelector(node, selector) && !targets.includes(node)) targets.push(node);
      }
    }
  }
  return targets;
}

function collectScriptTargets(scripts, rootNodes) {
  const elements = collectElementNodes(rootNodes, []);
  const targets = new Set();
  for (const script of scripts) {
    findJavaScriptTargets(extractJavaScriptSelectors(script.code), elements).forEach(node => targets.add(node));
  }
  return targets;
}

function buildJavaScriptPlan(scripts, rootNodes, defaultHost) {
  const elements = collectElementNodes(rootNodes, []);
  const jsByNode = new Map();
  const requiredClasses = new Set();
  const ownership = [];

  for (const script of scripts) {
    const selectors = extractJavaScriptSelectors(script.code);
    extractJavaScriptClassDependencies(script.code, selectors).forEach(className => requiredClasses.add(className));
    const targets = findJavaScriptTargets(selectors, elements);
    let owner = lowestCommonElementAncestor(targets);
    while (owner && !isConvertibleCssOwner(owner)) owner = getElementParent(owner);
    if (!owner) owner = defaultHost;
    if (!owner) continue;
    const existing = jsByNode.get(owner);
    jsByNode.set(owner, existing ? `${existing}\n\n${script.code}` : script.code);
    ownership.push({ node: owner, selectors, targetCount: targets.length });
  }
  return { jsByNode, requiredClasses, ownership };
}

const STRUCTURAL_CLASS_PREFIX = /^(?:align(?:full|wide)$|wp-|gs_|gsbp-|is-|has-)/;
const SEMANTIC_STRUCTURE_TAGS = new Set(['main','section','article','header','footer','nav','aside','form','details','summary']);

function collectClassDependenciesFromCss(css, output) {
  const dependencies = output || new Set();
  const matches = String(css || '').match(/\.([a-zA-Z_-][a-zA-Z0-9_-]*)/g) || [];
  matches.forEach(value => dependencies.add(value.slice(1)));
  return dependencies;
}

function buildClassRetentionPlan(bodyNodes, parsedCss, stylingPlan, javascriptPlan) {
  const requiredClasses = new Set(javascriptPlan.requiredClasses);
  collectClassDependenciesFromCss(stylingPlan.globalResidualCss, requiredClasses);
  for (const css of stylingPlan.residualCssByNode.values()) collectClassDependenciesFromCss(css, requiredClasses);
  const classNamesByNode = new Map();
  let removedOccurrences = 0;
  let preservedOccurrences = 0;

  for (const node of collectElementNodes(bodyNodes, [])) {
    const original = String(node.attributes.class || '').split(/\s+/).filter(Boolean);
    if (!original.length) continue;
    const preserved = original.filter(className => {
      const referencedBySourceCss = parsedCss.allClasses.has(className);
      const structurallyMeaningful = STRUCTURAL_CLASS_PREFIX.test(className) || SEMANTIC_STRUCTURE_TAGS.has(node.tagName);
      const interactivePublicHook = ['a','button','input','select','textarea'].includes(node.tagName);
      const hasBehavioralAttributes = Object.keys(node.attributes || {}).some(name =>
        name.startsWith('data-') || name.startsWith('aria-') || name.startsWith('on')
      );
      return requiredClasses.has(className) || structurallyMeaningful || interactivePublicHook || hasBehavioralAttributes || !referencedBySourceCss;
    });
    removedOccurrences += original.length - preserved.length;
    preservedOccurrences += preserved.length;
    classNamesByNode.set(node, preserved.join(' '));
  }
  return { classNamesByNode, requiredClasses, removedOccurrences, preservedOccurrences };
}

function getOutputClassName(node, cssContext) {
  if (cssContext && cssContext.classRetentionPlan && cssContext.classRetentionPlan.classNamesByNode.has(node)) {
    return cssContext.classRetentionPlan.classNamesByNode.get(node);
  }
  return node && node.attributes ? (node.attributes.class || '') : '';
}

function applyCssContextToParams(node, params, cssContext) {
  if (!cssContext) return '';

  const styleAttributes = { ...(params.styleAttributes || {}) };
  const customCssParts = [];

  if (cssContext.stylingPlan) {
    Object.assign(styleAttributes, cssContext.stylingPlan.nativeStylesByNode.get(node) || {});
  }
  if (node.type === 'element' && cssContext.stylingPlan) {
    const localizedResidual = cssContext.stylingPlan.residualCssByNode.get(node);
    if (localizedResidual) customCssParts.push(localizedResidual);
  }

  if (node === cssContext.hostNode && cssContext.residualCss) {
    customCssParts.push(cssContext.residualCss);
  }

  const localId = generateGsBlockId();
  params.id = localId;
  params.localId = localId;
  const hasCss = Object.keys(styleAttributes).length > 0 || customCssParts.length > 0;
  const customJs = cssContext.javascriptPlan && cssContext.javascriptPlan.jsByNode.get(node);
  const hasJs = Boolean(customJs);

  if (hasCss) {
    if (customCssParts.length > 0) {
      styleAttributes.customCSS_Extra = customCssParts.join('\n');
    }
    params.styleAttributes = styleAttributes;
  }

  if (hasJs) {
    params.customJs = customJs;
    params.customJsEnabled = true;
  }

  // GreenShift's save() only adds the localId class when the block has
  // styleAttributes, so the markup must not carry it otherwise.
  return hasCss ? localId : '';
}

const BLOCK_NAME_UTILITY_CLASSES = new Set([
  'alignfull', 'alignwide', 'wp-section', 'wp-content-wrap',
  'reveal', 'reveal-left', 'reveal-right', 'stagger'
]);

function humanizeBlockName(value) {
  if (!value) return '';
  let normalized = String(value).trim();
  // Source designs commonly namespace every class/id (for example mpr5-*).
  // Keep the meaningful portion while avoiding a hard-coded project prefix.
  normalized = normalized.replace(/^[a-z][a-z0-9]*\d+-/i, '');
  normalized = normalized
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return '';
  return normalized.replace(/\b\w/g, char => char.toUpperCase());
}

function truncateBlockName(value, maxLength) {
  const clean = String(value || '').replace(/\s+/g, ' ').trim();
  if (clean.length <= maxLength) return clean;
  return `${clean.slice(0, maxLength - 1).trimEnd()}…`;
}

function elementOrdinal(node) {
  const parent = getElementParent(node);
  if (!parent) return 1;
  const siblings = (parent.children || []).filter(child => child.type === 'element' && child.tagName === node.tagName);
  return Math.max(1, siblings.indexOf(node) + 1);
}

function hierarchyContextName(node) {
  let parent = getElementParent(node);
  while (parent) {
    const idName = humanizeBlockName(parent.attributes && parent.attributes.id);
    if (idName) return idName;
    const usefulClass = String((parent.attributes && parent.attributes.class) || '')
      .split(/\s+/)
      .filter(Boolean)
      .filter(className => !BLOCK_NAME_UTILITY_CLASSES.has(className))
      .map(humanizeBlockName)
      .filter(Boolean)
      .sort((left, right) => right.length - left.length)[0];
    if (usefulClass) return usefulClass;
    const heading = (parent.children || []).find(child => child.type === 'element' && /^h[1-6]$/.test(child.tagName));
    if (heading) {
      const headingText = getDirectTextContent(heading);
      if (headingText) return headingText;
    }
    parent = getElementParent(parent);
  }
  return '';
}

function genericBlockRole(node) {
  const roles = {
    main: 'Page', section: 'Section', article: 'Article', header: 'Header', footer: 'Footer',
    nav: 'Navigation', aside: 'Sidebar', div: 'Group', ul: 'List', ol: 'List', li: 'List item',
    p: 'Paragraph', blockquote: 'Quote', figure: 'Figure', figcaption: 'Caption', svg: 'Icon',
    img: 'Image', a: 'Link', span: 'Text', form: 'Form', label: 'Label', input: 'Field',
    textarea: 'Field', select: 'Select field', button: 'Button', table: 'Table', tr: 'Table row',
    td: 'Table cell', th: 'Table heading', details: 'Details', summary: 'Summary'
  };
  if (/^h[1-6]$/.test(node.tagName)) return 'Heading';
  return roles[node.tagName] || humanizeBlockName(node.tagName) || 'Element';
}

function deriveBlockName(node, directText, cssContext) {
  if (!node || node.type !== 'element') return '';

  const explicitName = node.attributes['data-block-name'] || node.attributes['data-title'];
  if (explicitName) return truncateBlockName(explicitName, 72);

  const tag = node.tagName;
  if (tag === 'main' && cssContext && cssContext.documentTitle) {
    return truncateBlockName(`${cssContext.documentTitle} — Page`, 72);
  }
  if (/^h[1-6]$/.test(tag) || tag === 'button' || tag === 'summary') {
    if (directText) return truncateBlockName(directText, 72);
  }

  const idName = humanizeBlockName(node.attributes.id);
  if (idName) return truncateBlockName(idName, 72);

  const accessibleName = node.attributes['aria-label'] || node.attributes.alt || node.attributes.title || node.attributes.placeholder;
  if (accessibleName) return truncateBlockName(accessibleName, 72);

  const sourceClasses = String(node.attributes.class || '')
    .split(/\s+/)
    .filter(Boolean)
    .filter(className => !BLOCK_NAME_UTILITY_CLASSES.has(className))
    .filter(className => !/^mpr?\d*-delay-/i.test(className));

  if (sourceClasses.length > 0) {
    // The most specific class generally carries the best List View label
    // (for example "service-featured" instead of just "service").
    const bestClass = sourceClasses
      .map(className => ({ raw: className, name: humanizeBlockName(className) }))
      .filter(item => item.name)
      .sort((a, b) => b.name.length - a.name.length)[0];
    if (bestClass) return truncateBlockName(bestClass.name, 72);
  }

  if (directText) {
    return truncateBlockName(directText, 72);
  }

  const role = genericBlockRole(node);
  const parent = getElementParent(node);
  const siblings = parent
    ? (parent.children || []).filter(child => child.type === 'element' && child.tagName === tag)
    : [];
  const numberedRole = siblings.length > 1 ? `${role} ${elementOrdinal(node)}` : role;
  const context = hierarchyContextName(node);
  return truncateBlockName(context ? `${context} — ${numberedRole}` : numberedRole, 72);
}

function appendClassToOpeningTag(html, className) {
  if (!className) return html;
  return html.replace(/^<([a-zA-Z0-9:-]+)([^>]*)>/, (match, tagName, attrs) => {
    if (/\sclass\s*=\s*["']/i.test(attrs)) {
      return `<${tagName}${attrs.replace(/(\sclass\s*=\s*["'])([^"']*)(["'])/i, `$1$2 ${className}$3`)}>`;
    }
    return `<${tagName}${attrs} class="${className}">`;
  });
}

function replaceOpeningTagClass(html, className) {
  return html.replace(/^<([a-zA-Z0-9:-]+)([^>]*)>/, (match, tagName, attrs) => {
    let updated = attrs.replace(/\sclass\s*=\s*(?:"[^"]*"|'[^']*')/i, '');
    if (className) updated += ` class="${className}"`;
    return `<${tagName}${updated}>`;
  });
}

function convertNodeToBlock(node, cssContext) {
  if (node.type === 'text') {
    const text = node.content.trim();
    if (!text) return null;
    const params = { textContent: text, tag: 'span', metadata: { name: truncateBlockName(text, 72) } };
    const localId = applyCssContextToParams(node, params, cssContext);
    const json = wpJsonEncode(params);
    const classAttr = localId ? ` class="${localId}"` : '';
    return `<!-- wp:greenshift-blocks/element ${json} -->\n<span${classAttr}>${escHtml(text)}</span>\n<!-- /wp:greenshift-blocks/element -->`;
  }

  if (node.type !== 'element') return null;
  const tag = node.tagName;
  const dynamicTextValue = node.attributes['data-gl-dynamic-text'];
  const dynamicHrefValue = node.attributes['data-gl-dynamic-href'];
  const dynamicSrcValue = node.attributes['data-gl-dynamic-src'];
  const dynamicAltValue = node.attributes['data-gl-dynamic-alt'];
  const dynamicTitleValue = node.attributes['data-gl-dynamic-title'];
  const queryArgsValue = node.attributes['data-gl-query-arguments'];
  const hasQueryGrid = Boolean(queryArgsValue);
  const renderChildren = getRenderableChildren(node, dynamicTextValue);

  if (SKIP_TAGS.has(tag)) return null;

  // Handle br
  if (tag === 'br') {
    const params = { tag: 'span', type: 'html', textContent: '<br />', metadata: { name: 'Line break' } };
    const localId = applyCssContextToParams(node, params, cssContext);
    const classAttr = localId ? ` class="${localId}"` : '';
    return `<!-- wp:greenshift-blocks/element ${wpJsonEncode(params)} -->\n<span${classAttr}><br /></span>\n<!-- /wp:greenshift-blocks/element -->`;
  }

  // Handle hr
  if (tag === 'hr') {
    const params = { tag: 'span', type: 'html', textContent: '<hr />', metadata: { name: 'Divider' } };
    const localId = applyCssContextToParams(node, params, cssContext);
    const classAttr = localId ? ` class="${localId}"` : '';
    return `<!-- wp:greenshift-blocks/element ${wpJsonEncode(params)} -->\n<span${classAttr}><hr /></span>\n<!-- /wp:greenshift-blocks/element -->`;
  }

  // Handle SVG
  if (tag === 'svg') {
    let svgHTML = node.outerHTML || '<svg></svg>';
    // GreenShift merges a class found in svgRaw into the saved markup, so the
    // class lives only in className/the markup, never in svgRaw.
    const params = {
      tag: 'svg',
      icon: { icon: { svgRaw: replaceOpeningTagClass(svgHTML, ''), image: '' }, type: 'svg' }
    };
    const w = node.attributes['width'];
    const h = node.attributes['height'];
    if (w || h) {
      params.styleAttributes = {};
      if (w) params.styleAttributes.width = responsiveValue(w.includes('px') ? w : `${w}px`);
      if (h) params.styleAttributes.height = responsiveValue(h.includes('px') ? h : `${h}px`);
    }

    const cls = getOutputClassName(node, cssContext);
    if (cls) params.className = cls;
    if (cls !== (node.attributes['class'] || '')) svgHTML = replaceOpeningTagClass(svgHTML, cls);
    const blockName = deriveBlockName(node, '', cssContext);
    if (blockName) params.metadata = { name: blockName };
    const localId = applyCssContextToParams(node, params, cssContext);
    if (localId) svgHTML = appendClassToOpeningTag(svgHTML, localId);

    return `<!-- wp:greenshift-blocks/element ${wpJsonEncode(params)} -->\n${svgHTML}\n<!-- /wp:greenshift-blocks/element -->`;
  }

  const type = getTypeFromTag(tag);
  const params = { tag };
  let effectiveType = type;

  // className
  const cls = getOutputClassName(node, cssContext);
  if (cls) {
    if (hasQueryGrid) params.wrapperClasses = cls;
    else params.className = cls;
  }

  const isTopLevelFullWidth = Boolean(cssContext && cssContext.fullWidthNodes && cssContext.fullWidthNodes.has(node));
  if (isTopLevelFullWidth && !hasQueryGrid) {
    const classNames = String(params.className || '').split(/\s+/).filter(Boolean);
    if (!classNames.includes('alignfull')) classNames.push('alignfull');
    params.className = classNames.join(' ');
    params.align = 'full';
  }

  // anchor (id)
  const idAttr = node.attributes['id'];
  if (idAttr) params.anchor = idAttr;

  // Section/content-area component variations (check before building dynAttrs)
  const dataType = node.attributes['data-type'];
  if (dataType === 'content-area-component') params.isVariation = 'nocolumncontent';
  else if (dataType === 'section-component') params.isVariation = 'contentwrapper';
  if (cls && cls.split(/\s+/).includes('alignfull')) params.align = 'full';

  // data-*, on*, style attributes -> dynamicAttributes. Keep data-type even
  // when it also selects a GreenShift variation; reference output preserves
  // the authored structural attribute alongside isVariation.
  const dynAttrs = [];
  for (const [name, value] of Object.entries(node.attributes)) {
    if (name.startsWith('data-') || name.startsWith('on') || name === 'style' || name.startsWith('aria-') || name === 'crossorigin') {
      dynAttrs.push({ name, value });
    }
  }
  if (dynAttrs.length > 0) params.dynamicAttributes = dynAttrs;

  // Check children
  const hasElChildren = hasElementChildrenIn(renderChildren);
  const directText = dynamicTextValue || getDirectTextContentFromChildren(renderChildren);

  // Text content handling
  if (type === 'text') {
    if (directText) params.textContent = directText;
  }

  if (type === 'inner' && !hasElChildren && directText) {
    effectiveType = 'text';
    params.textContent = directText;
  }

  if (type === 'text' && !directText && !hasElChildren) {
    effectiveType = 'no';
  }

  if (type === 'inner' && !hasElChildren && !directText) {
    effectiveType = 'no';
  }

  const blockName = deriveBlockName(node, directText, cssContext);
  if (blockName) params.metadata = { name: blockName };

  // Link attributes
  if (tag === 'a') {
    const href = dynamicHrefValue || node.attributes['href'];
    if (href) params.href = href;
    if (node.attributes['target'] === '_blank') params.linkNewWindow = true;
    const rel = node.attributes['rel'] || '';
    if (rel.includes('nofollow')) params.linkNoFollow = true;
    if (rel.includes('sponsored')) params.linkSponsored = true;
    const title = dynamicTitleValue || node.attributes['title'];
    if (title) params.title = title;
  }

  // Image attributes
  if (tag === 'img') {
    const src = dynamicSrcValue || node.attributes['src'];
    if (src) params.src = src;
    const alt = dynamicAltValue || node.attributes['alt'];
    if (alt) params.alt = alt;
    const origW = node.attributes['width'];
    const origH = node.attributes['height'];
    if (origW) params.originalWidth = parseInt(origW, 10) || undefined;
    if (origH) params.originalHeight = parseInt(origH, 10) || undefined;
    effectiveType = 'no';
  }

  // Video attributes
  if (tag === 'video') {
    const src = dynamicSrcValue || node.attributes['src'];
    if (src) params.src = src;
    const poster = node.attributes['poster'];
    if (poster) params.poster = poster;
    if ('loop' in node.attributes) params.loop = true;
    if ('autoplay' in node.attributes) params.autoplay = true;
    if ('muted' in node.attributes) params.muted = true;
    if ('controls' in node.attributes) params.controls = true;
    if ('playsinline' in node.attributes) params.playsinline = true;
  }

  // Iframe attributes — only `src` is consumed natively by element/save.js;
  // everything else must go through dynamicAttributes (which the block
  // applies on top of blockProps at render time).
  if (tag === 'iframe') {
    const rawSrc = dynamicSrcValue || node.attributes['src'];
    const src = rawSrc ? toYoutubeEmbed(rawSrc) : rawSrc;
    if (src) params.src = src;
    const iframeAttrNames = ['title', 'allow', 'allowfullscreen', 'referrerpolicy', 'sandbox', 'name', 'width', 'height', 'frameborder', 'loading'];
    for (const attrName of iframeAttrNames) {
      if (attrName in node.attributes) {
        dynAttrs.push({ name: attrName, value: node.attributes[attrName] || '' });
      }
    }
    if (dynAttrs.length > 0) params.dynamicAttributes = dynAttrs;
    effectiveType = 'no';
  }

  // Form element attributes
  if (tag === 'input' || tag === 'textarea' || tag === 'select' || tag === 'button') {
    const fa = {};
    const inputType = node.attributes['type'];
    if (inputType) fa.type = inputType;
    const name = node.attributes['name'];
    if (name) fa.name = name;
    const placeholder = node.attributes['placeholder'];
    if (placeholder) fa.placeholder = placeholder;
    const value = node.attributes['value'];
    if (value) fa.value = value;
    if ('required' in node.attributes) fa.required = true;
    if ('disabled' in node.attributes) fa.disabled = true;
    if (Object.keys(fa).length > 0) params.formAttributes = fa;
  }

  // Form tag attributes (method, action) – match elementcontainer.js blockProps
  if (tag === 'form') {
    const fa = {};
    const method = node.attributes['method'];
    fa.method = (method && method.toLowerCase() === 'post') ? 'post' : 'get';
    const action = node.attributes['action'];
    if (action) fa.action = action;
    else fa.action = '';
    params.formAttributes = fa;
  }

  // Table cell attributes
  if (tag === 'td' || tag === 'th') {
    const colspan = node.attributes['colspan'];
    if (colspan) params.colSpan = parseInt(colspan, 10);
    const rowspan = node.attributes['rowspan'];
    if (rowspan) params.rowSpan = parseInt(rowspan, 10);
  }

  // Always set type explicitly
  params.type = effectiveType;

  // Convert child elements to inner blocks
  let innerBlocksStr = '';
  if (effectiveType === 'text' && !hasElChildren) {
    // text-only, no inner blocks
  } else if (effectiveType !== 'no') {
    const childBlocks = [];
    for (const child of renderChildren) {
      const childBlock = convertNodeToBlock(child, cssContext);
      if (childBlock) childBlocks.push(childBlock);
    }
    if (childBlocks.length > 0) {
      // If text-type with inner blocks, change to inner
      if (effectiveType === 'text') {
        effectiveType = 'inner';
        params.type = 'inner';
        delete params.textContent;
      }
      innerBlocksStr = childBlocks.join('\n');
    }
  }

  if (hasQueryGrid) {
    const queryFilters = parseJsonAttribute(queryArgsValue) || {};
    const queryParams = {
      id: generateGsBlockId(),
      data_source: 'query',
      displayStyle: 'custom',
      query_filters: queryFilters
    };
    const queryJson = wpJsonEncode(queryParams);
    if (innerBlocksStr) {
      return `<!-- wp:greenshift-blocks/querygrid ${queryJson} -->\n${innerBlocksStr}\n<!-- /wp:greenshift-blocks/querygrid -->`;
    }
    return `<!-- wp:greenshift-blocks/querygrid ${queryJson} /-->`;
  }

  // Build HTML output
  const localId = applyCssContextToParams(node, params, cssContext);
  const json = wpJsonEncode(params);
  let htmlAttrs = '';
  const outputClassName = [params.className || cls, localId].filter(Boolean).join(' ');
  if (outputClassName) htmlAttrs += ` class="${outputClassName}"`;
  if (idAttr) htmlAttrs += ` id="${idAttr}"`;
  const titleAttrValue = dynamicTitleValue || node.attributes['title'];

  // Add specific HTML attributes based on tag
  if (tag === 'a') {
    if (params.href) htmlAttrs += ` href="${escHtml(params.href)}"`;
    if (params.linkNewWindow) htmlAttrs += ` target="_blank" rel="noopener${params.linkNoFollow ? ' nofollow' : ''}${params.linkSponsored ? ' sponsored' : ''}"`;
    else if (params.linkNoFollow || params.linkSponsored) {
      const rels = [];
      if (params.linkNoFollow) rels.push('nofollow');
      if (params.linkSponsored) rels.push('sponsored');
      htmlAttrs += ` rel="${rels.join(' ')}"`;
    }
    if (params.title) htmlAttrs += ` title="${escHtml(params.title)}"`;
  }
  if (tag !== 'a' && tag !== 'iframe' && titleAttrValue) htmlAttrs += ` title="${escHtml(titleAttrValue)}"`;
  if (tag === 'img') {
    if (params.src) htmlAttrs += ` src="${escHtml(params.src)}"`;
    if (params.alt) htmlAttrs += ` alt="${escHtml(params.alt)}"`;
    if (params.originalWidth) htmlAttrs += ` width="${params.originalWidth}"`;
    if (params.originalHeight) htmlAttrs += ` height="${params.originalHeight}"`;
    htmlAttrs += ` loading="lazy"`;
  }
  if (tag === 'video') {
    // NOTE: `src` is intentionally NOT emitted on the <video> tag. The block's
    // save() renders it as a <source> child (built as mediaSourceHtml below),
    // so putting src on <video> would break Gutenberg block validation.
    if (params.poster) htmlAttrs += ` poster="${escHtml(params.poster)}"`;
    if (params.loop) htmlAttrs += ` loop`;
    if (params.autoplay) htmlAttrs += ` autoplay`;
    if (params.muted) htmlAttrs += ` muted`;
    if (params.controls) htmlAttrs += ` controls`;
    if (params.playsinline) htmlAttrs += ` playsinline`;
  }
  if (tag === 'iframe') {
    if (params.src) htmlAttrs += ` src="${escHtml(params.src)}"`;
  }
  if ((tag === 'input' || tag === 'textarea' || tag === 'select' || tag === 'button') && params.formAttributes) {
    const fa = params.formAttributes;
    if (fa.type) htmlAttrs += ` type="${fa.type}"`;
    if (fa.name) htmlAttrs += ` name="${fa.name}"`;
    if (fa.placeholder) htmlAttrs += ` placeholder="${escHtml(fa.placeholder)}"`;
    if (fa.value) htmlAttrs += ` value="${escHtml(fa.value)}"`;
    if (fa.required) htmlAttrs += ` required`;
    if (fa.disabled) htmlAttrs += ` disabled`;
  }
  if (tag === 'form' && params.formAttributes) {
    const fa = params.formAttributes;
    htmlAttrs += ` method="${escHtml(fa.method || 'get')}"`;
    htmlAttrs += ` action="${escHtml(fa.action != null ? fa.action : '')}"`;
  }
  if (tag === 'td' || tag === 'th') {
    if (params.colSpan) htmlAttrs += ` colspan="${params.colSpan}"`;
    if (params.rowSpan) htmlAttrs += ` rowspan="${params.rowSpan}"`;
  }

  if (dynAttrs.length > 0) {
    for (const da of dynAttrs) {
      htmlAttrs += formatHtmlAttribute(da.name, da.value);
    }
  }

  // Build the block

  // <video>/<audio> carry their src as a <source> child to match the block's
  // save() output (Gutenberg validates the saved markup against save(), which
  // renders <source src="..." type="video/<ext>"/>, not src on the media tag).
  let mediaSourceHtml = '';
  if ((tag === 'video' || tag === 'audio') && params.src) {
    mediaSourceHtml = `<source src="${escHtml(params.src)}" type="${tag}/${getMediaExtension(params.src)}"/>`;
  }

  if (VOID_TAGS.has(tag)) {
    return `<!-- wp:greenshift-blocks/element ${json} -->\n<${tag}${htmlAttrs}/>\n<!-- /wp:greenshift-blocks/element -->`;
  }

  const innerHtml = mediaSourceHtml + innerBlocksStr;
  const textContent = params.textContent || '';
  if (innerHtml) {
    return `<!-- wp:greenshift-blocks/element ${json} -->\n<${tag}${htmlAttrs}>${innerHtml}</${tag}>\n<!-- /wp:greenshift-blocks/element -->`;
  } else if (textContent) {
    return `<!-- wp:greenshift-blocks/element ${json} -->\n<${tag}${htmlAttrs}>${escHtml(textContent)}</${tag}>\n<!-- /wp:greenshift-blocks/element -->`;
  } else {
    return `<!-- wp:greenshift-blocks/element ${json} -->\n<${tag}${htmlAttrs}></${tag}>\n<!-- /wp:greenshift-blocks/element -->`;
  }
}

// Mirrors the element block's save() getFileExtension so <source type="..."> matches.
function getMediaExtension(url) {
  if (!url) return '';
  const path = url.split('/').pop();
  const lastDotIndex = path.lastIndexOf('.');
  return path.slice(lastDotIndex + 1);
}

function toYoutubeEmbed(url) {
  if (!url || typeof url !== 'string') return url;
  const trimmed = url.trim();
  // Already an embed URL — leave alone
  if (/^https?:\/\/(?:www\.)?youtube(?:-nocookie)?\.com\/embed\//i.test(trimmed)) return trimmed;

  // youtu.be/<id>[?...]
  let m = trimmed.match(/^https?:\/\/youtu\.be\/([A-Za-z0-9_-]{6,})(\?[^#]*)?(#.*)?$/i);
  if (m) {
    const id = m[1];
    const query = m[2] || '';
    return `https://www.youtube.com/embed/${id}${query}`;
  }

  // youtube.com/shorts/<id>
  m = trimmed.match(/^https?:\/\/(?:www\.|m\.)?youtube\.com\/shorts\/([A-Za-z0-9_-]{6,})(\?[^#]*)?(#.*)?$/i);
  if (m) {
    return `https://www.youtube.com/embed/${m[1]}${m[2] || ''}`;
  }

  // youtube.com/watch?v=<id>&...
  m = trimmed.match(/^https?:\/\/(?:www\.|m\.)?youtube\.com\/watch\?([^#]*)(#.*)?$/i);
  if (m) {
    const params = new URLSearchParams(m[1]);
    const id = params.get('v');
    if (!id) return trimmed;
    params.delete('v');
    const rest = params.toString();
    return `https://www.youtube.com/embed/${id}${rest ? `?${rest}` : ''}`;
  }

  return trimmed;
}

function formatHtmlAttribute(name, value) {
  if (value === '') return ` ${name}`;
  return ` ${name}="${escHtml(value)}"`;
}

function serializeVoidElement(node) {
  let html = `<${node.tagName}`;
  for (const [name, value] of Object.entries(node.attributes || {})) {
    html += formatHtmlAttribute(name, value);
  }
  html += '>';
  return html;
}

function buildRawHtmlBlock(rawHtml, name) {
  const params = name ? { metadata: { name } } : {};
  const json = wpJsonEncode(params);
  return `<!-- wp:html ${json} -->\n${rawHtml}\n<!-- /wp:html -->`;
}

function escHtml(s) {
  return s.replace(/&(?!#?\w+;)/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function wpJsonEncode(obj) {
  return JSON.stringify(obj)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');
}

// ─── Main Pipeline ──────────────────────────────────────────────────────────

function convert(htmlInput) {
  resetGeneratedBlockIds();
  const nodes = parseHTML(htmlInput);
  annotateHtmlTree(nodes, null);

  // Extract <style> and <script> content
  const styles = [];
  const scripts = [];
  const links = [];
  let documentTitle = '';

  function collectMeta(nodeList) {
    for (const node of nodeList) {
      if (node.type === 'element') {
        if (node.tagName === 'style' && node.rawText && node.rawText.trim()) {
          styles.push(node.rawText.trim());
        }
        if (node.tagName === 'script' && !node.attributes['src'] && node.rawText && node.rawText.trim()) {
          scripts.push({ code: node.rawText.trim(), sourceOrder: scripts.length, sourceNode: node });
        }
        if (node.tagName === 'link') {
          const linkHtml = node.outerHTML || serializeVoidElement(node);
          links.push(linkHtml);
        }
        if (node.tagName === 'title' && !documentTitle) {
          documentTitle = getDirectTextContent(node).trim();
        }
        // Recurse into children to find nested style/script (e.g. inside <head>)
        if (node.children) collectMeta(node.children);
      }
    }
  }
  collectMeta(nodes);

  // Find body content - if there's a <body> or <html>, use their children
  function findBodyNodes(nodeList) {
    for (const node of nodeList) {
      if (node.type === 'element') {
        if (node.tagName === 'body') return node.children || [];
        if (node.tagName === 'html' && node.children) {
          const bodyResult = findBodyNodes(node.children);
          if (bodyResult) return bodyResult;
          // If no explicit body, return html's children (skip head)
          return node.children.filter(c => c.type !== 'element' || c.tagName !== 'head');
        }
      }
    }
    return null;
  }

  const documentBodyNodes = findBodyNodes(nodes);
  const bodyNodes = documentBodyNodes || nodes;
  const combinedCss = styles.join('\n\n');
  const combinedJs = scripts.map(script => script.code).join('\n\n');
  const parsedCss = combinedCss
    ? parseCss(combinedCss)
    : { classes: {}, allClasses: new Set(), nonClassCss: '', orderedNodes: [], ruleRecords: [], unsupportedSelectors: [], keyframes: new Map(), globalAtRules: [], mediaConditions: new Set() };
  const cascade = buildCssCascade(nodes, parsedCss);
  const stylingPlan = buildNativeStylingPlan(bodyNodes, parsedCss, cascade, collectScriptTargets(scripts, bodyNodes));
  const residualCss = stylingPlan.globalResidualCss;

  let hostNode = findFirstBlockHost(bodyNodes);
  if (!hostNode && (residualCss || combinedJs)) {
    hostNode = { type: 'element', tagName: 'div', attributes: {}, children: [], outerHTML: '' };
    bodyNodes.push(hostNode);
  }
  const javascriptPlan = buildJavaScriptPlan(scripts, bodyNodes, hostNode);
  const classRetentionPlan = buildClassRetentionPlan(bodyNodes, parsedCss, stylingPlan, javascriptPlan);
  const topLevelElements = bodyNodes.filter(node => node.type === 'element' && !SKIP_TAGS.has(node.tagName));
  const fullWidthNodes = new Set(topLevelElements.filter(node => {
    const classes = String(node.attributes.class || '').split(/\s+/);
    return classes.includes('alignfull') || node.tagName === 'main' ||
      (node.tagName === 'section' && node.attributes['data-type'] === 'section-component');
  }));

  const cssContext = {
    parsedCss,
    cascade,
    stylingPlan,
    residualCss,
    javascriptPlan,
    classRetentionPlan,
    documentTitle,
    hostNode,
    fullWidthNodes
  };

  // Convert visible nodes to blocks
  const blocks = [];
  for (const node of bodyNodes) {
    if (node.type === 'element' && SKIP_TAGS.has(node.tagName)) continue;
    const block = convertNodeToBlock(node, cssContext);
    if (block) blocks.push(block);
  }

  const output = [];
  if (links.length > 0) output.push(buildRawHtmlBlock(links.join('\n'), 'Links Import'));
  output.push(...blocks);

  return output.join('\n\n');
}

// ─── CLI Entry Point ────────────────────────────────────────────────────────

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  console.log(`Usage:
  node convert.js <input.html>              Convert file, output to stdout
  node convert.js <input.html> -o out.txt   Convert file, write to out.txt
  cat file.html | node convert.js           Convert from stdin`);
  process.exit(0);
}

function run(html) {
  const result = convert(html);
  const outIdx = args.indexOf('-o');
  if (outIdx !== -1 && args[outIdx + 1]) {
    const outPath = path.resolve(args[outIdx + 1]);
    fs.writeFileSync(outPath, result, 'utf8');
    console.error(`Written to ${outPath}`);
  } else {
    process.stdout.write(result + '\n');
  }
}

if (args.length > 0 && args[0] !== '-o' && !args[0].startsWith('-')) {
  const filePath = path.resolve(args[0]);
  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(1);
  }
  run(fs.readFileSync(filePath, 'utf8'));
} else {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => { input += chunk; });
  process.stdin.on('end', () => { run(input); });
}
