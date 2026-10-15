// Bear-style inline markdown editor.
//
// Markdown remains the source of truth (so embeddings, search, and the
// REST API still see plain text). What the user sees while editing is
// styled: headings render larger, **bold** is bold, *italic* is italic,
// `code` is monospace with a tinted background. Markers (#, **, `) stay
// visible but in a muted color so the syntax remains discoverable —
// matches Bear's behavior, not the cursor-aware hide-on-blur approach
// Obsidian uses.
//
// Inline emphasis (bold/italic/strike/code) is handled by a
// HighlightStyle that maps Lezer tags to CSS. Block-level affordances
// that need per-line decoration — horizontal rules, blockquotes, list
// items — are added by a ViewPlugin that walks the syntax tree and
// attaches line classes the theme can style (HR border, quote bar,
// list indent + bullet).
import { useMemo } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { HighlightStyle, syntaxHighlighting, syntaxTree } from '@codemirror/language';
import { RangeSetBuilder } from '@codemirror/state';
import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view';
import { tags as t } from '@lezer/highlight';

const bearHighlight = HighlightStyle.define([
  // Headings — keep the # visible (handled in the marker rule below) but
  // the actual heading content gets larger + bolder.
  { tag: t.heading1, fontSize: '1.6em', fontWeight: '700', lineHeight: '1.3' },
  { tag: t.heading2, fontSize: '1.35em', fontWeight: '700', lineHeight: '1.3' },
  { tag: t.heading3, fontSize: '1.15em', fontWeight: '600', lineHeight: '1.3' },
  { tag: t.heading4, fontSize: '1.05em', fontWeight: '600' },
  { tag: t.heading5, fontWeight: '600' },
  { tag: t.heading6, fontWeight: '600' },
  // The #, **, *, `, > markers — keep visible but muted.
  { tag: t.processingInstruction, color: 'var(--muted)', fontWeight: '400' },
  { tag: t.contentSeparator, color: 'var(--muted)' },
  // Inline emphasis. Bold gets weight 800 + a slight color lift so it
  // actually reads as bold at 13.5px in the body sans — weight 700
  // alone was too subtle for Pablo to perceive.
  { tag: t.strong, fontWeight: '800', color: 'var(--fg)' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  // Code spans + fenced code blocks.
  { tag: t.monospace, fontFamily: 'var(--font-mono)', background: 'var(--glass-bg-soft)', padding: '1px 4px', borderRadius: '4px', fontSize: '0.92em' },
  // Links: text colored, URL muted.
  { tag: t.link, color: 'var(--accent-1)' },
  { tag: t.url, color: 'var(--muted)', textDecoration: 'none' },
  // Lists + blockquotes get slightly muted markers.
  { tag: t.list, color: 'var(--text)' },
  { tag: t.quote, color: 'var(--muted)', fontStyle: 'italic' },
]);

// Block-level decorations:
//   - HorizontalRule  → .cm-md-hr line class (theme draws a bottom border)
//   - Blockquote      → .cm-md-quote line class (theme adds a left bar)
//   - ListItem        → .cm-md-li line class (theme indents the line)
// The syntax tree is re-walked when the doc or viewport changes; for
// long docs this is bounded by visibleRanges so off-screen content
// isn't iterated.
const lineDecorationsPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = this.build(view);
    }
    update(update: ViewUpdate) {
      if (
        update.docChanged
        || update.viewportChanged
        || syntaxTree(update.state) !== syntaxTree(update.startState)
      ) {
        this.decorations = this.build(update.view);
      }
    }
    build(view: EditorView): DecorationSet {
      const builder = new RangeSetBuilder<Decoration>();
      // Track which line offsets already received a decoration so we
      // don't push duplicates when nested syntax (e.g. blockquote
      // containing a list) iterates the same line twice. RangeSetBuilder
      // requires strictly increasing positions, so dedup is mandatory.
      const tagged = new Map<number, string>();
      const tag = (lineStart: number, cls: string) => {
        const prev = tagged.get(lineStart);
        if (prev === cls) return;
        if (prev) {
          // Compose multiple block contexts on the same line, e.g.
          // a list item inside a blockquote.
          tagged.set(lineStart, `${prev} ${cls}`);
        } else {
          tagged.set(lineStart, cls);
        }
      };
      for (const { from, to } of view.visibleRanges) {
        syntaxTree(view.state).iterate({
          from,
          to,
          enter: (node) => {
            if (node.name === 'HorizontalRule') {
              const line = view.state.doc.lineAt(node.from);
              tag(line.from, 'cm-md-hr');
            } else if (node.name === 'Blockquote') {
              let pos = node.from;
              while (pos < node.to) {
                const line = view.state.doc.lineAt(pos);
                tag(line.from, 'cm-md-quote');
                if (line.to >= node.to) break;
                pos = line.to + 1;
              }
            } else if (node.name === 'ListItem') {
              const line = view.state.doc.lineAt(node.from);
              tag(line.from, 'cm-md-li');
            }
          },
        });
      }
      const offsets = Array.from(tagged.keys()).sort((a, b) => a - b);
      for (const off of offsets) {
        builder.add(off, off, Decoration.line({ class: tagged.get(off)! }));
      }
      return builder.finish();
    }
  },
  {
    decorations: (v) => v.decorations,
  },
);

const editorTheme = EditorView.theme(
  {
    '&': {
      fontSize: '13.5px',
      height: '100%',
      background: 'transparent',
    },
    '.cm-scroller': {
      fontFamily: 'var(--font-sans)',
      lineHeight: '1.6',
      padding: '6px 4px',
    },
    '.cm-content': {
      color: 'var(--fg)',
      caretColor: 'var(--accent-1)',
    },
    '.cm-line': {
      padding: '0 6px',
    },
    '&.cm-focused': {
      outline: 'none',
    },
    '.cm-cursor, .cm-dropCursor': {
      borderLeftColor: 'var(--accent-1)',
    },
    '.cm-selectionBackground, ::selection': {
      background: 'var(--accent-soft, rgba(120,120,255,0.18)) !important',
    },
    '.cm-activeLine': {
      background: 'transparent',
    },
    '.cm-gutters': {
      display: 'none',
    },
    // Block-level decorations applied by lineDecorationsPlugin.
    // Horizontal rule (---, ***, ___): the dashes stay editable, but the
    // line gets a real underline so it visually reads as a separator.
    '.cm-md-hr': {
      borderBottom: '0.5px solid var(--hairline)',
      paddingBottom: '4px',
      marginBottom: '4px',
    },
    '.cm-md-hr .cm-line, .cm-md-hr': {
      color: 'var(--muted)',
    },
    // Blockquote: a vertical bar on the left + indent so multi-line
    // quotes read as a callout. The `>` marker is already muted by
    // bearHighlight. Longhand border-* props are used because the
    // `borderLeft` shorthand silently dropped through CodeMirror's
    // theme-to-stylesheet conversion (computed width stayed 0).
    '.cm-md-quote': {
      borderLeftWidth: '3px',
      borderLeftStyle: 'solid',
      borderLeftColor: 'var(--accent-1)',
      // Total left inset stays at the same visual position as
      // surrounding paragraphs (6px) — the bar sits at the line edge
      // and the text is pushed 9px further right. We don't use a
      // negative marginLeft because the parent `.note-editor-pane`
      // has overflow: hidden and would clip the bar off-screen.
      paddingLeft: '15px',
    },
    // List item: nudge the marker rightward so the visual hierarchy is
    // closer to a rendered list. We can't replace `-` with `•` without
    // breaking the source, so the marker remains as typed but the line
    // gets a subtle indent.
    '.cm-md-li': {
      paddingLeft: '14px',
    },
  },
  { dark: true },
);

interface Props {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
}

export function MarkdownEditor({ value, onChange, placeholder, autoFocus }: Props) {
  const extensions = useMemo(
    () => [
      markdown({ base: markdownLanguage }),
      syntaxHighlighting(bearHighlight),
      lineDecorationsPlugin,
      editorTheme,
      EditorView.lineWrapping,
    ],
    [],
  );

  return (
    <CodeMirror
      value={value}
      onChange={onChange}
      extensions={extensions}
      // theme="none" disables @uiw/react-codemirror's default *light* theme
      // (which paints cm-editor with a white background and made our bright
      // text look ghostly white-on-white). Our custom editorTheme above is
      // the only one that should apply.
      theme="none"
      placeholder={placeholder}
      autoFocus={autoFocus}
      basicSetup={{
        lineNumbers: false,
        foldGutter: false,
        highlightActiveLine: false,
        highlightActiveLineGutter: false,
        autocompletion: false,
        searchKeymap: false,
      }}
      style={{ height: '100%' }}
    />
  );
}
