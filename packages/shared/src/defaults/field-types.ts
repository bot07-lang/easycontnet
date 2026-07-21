/**
 * The field-type palette. Fixed and system-wide — every template in every
 * project draws from this same set. Observed directly from the "+ ADD A NEW
 * FIELD" menu.
 *
 * Two groups, and the distinction is structural rather than cosmetic:
 *
 *   INPUT fields hold a value the writer supplies.
 *   SECTION fields hold no value at all — they are layout and instruction,
 *   rendered as static text in the editor. They still occupy a position in
 *   the field order, which is why they are fields and not decoration.
 *
 * SYSTEM fields (Title, Main content, Files, Featured image, Excerpt, Tags,
 * Slug, Meta title, Meta description) are deliberately absent: they cannot be
 * added, only shown or hidden, so they never appear in this menu.
 */

export const INPUT_FIELD_TYPES = [
  'single_line_text',
  'paragraph_text',
  'file_image_upload',
  'single_image',
  'checkboxes',
  'radio_buttons',
  'date',
  'dropdown_select',
] as const;

export const SECTION_FIELD_TYPES = ['heading', 'guidelines'] as const;

export const FIELD_TYPES = [...INPUT_FIELD_TYPES, ...SECTION_FIELD_TYPES] as const;

export type InputFieldType = (typeof INPUT_FIELD_TYPES)[number];
export type SectionFieldType = (typeof SECTION_FIELD_TYPES)[number];
export type FieldType = (typeof FIELD_TYPES)[number];

export interface FieldTypeMeta {
  type: FieldType;
  label: string;
  group: 'input' | 'section';
  /** Whether the field stores a value at all. */
  holdsValue: boolean;
  /** Whether a recommended length can be configured. Text fields only. */
  supportsLength: boolean;
  /** Whether the field carries a list of options. */
  supportsChoices: boolean;
}

export const FIELD_TYPE_META: Record<FieldType, FieldTypeMeta> = {
  single_line_text: {
    type: 'single_line_text', label: 'Single line text', group: 'input',
    holdsValue: true, supportsLength: true, supportsChoices: false,
  },
  // Carries a plain/rich toggle. Rich is the full editor; plain is a textarea.
  paragraph_text: {
    type: 'paragraph_text', label: 'Paragraph text', group: 'input',
    holdsValue: true, supportsLength: true, supportsChoices: false,
  },
  file_image_upload: {
    type: 'file_image_upload', label: 'File/Image upload', group: 'input',
    holdsValue: true, supportsLength: false, supportsChoices: false,
  },
  single_image: {
    type: 'single_image', label: 'Single image', group: 'input',
    holdsValue: true, supportsLength: false, supportsChoices: false,
  },
  checkboxes: {
    type: 'checkboxes', label: 'Checkboxes', group: 'input',
    holdsValue: true, supportsLength: false, supportsChoices: true,
  },
  radio_buttons: {
    type: 'radio_buttons', label: 'Radio buttons', group: 'input',
    holdsValue: true, supportsLength: false, supportsChoices: true,
  },
  date: {
    type: 'date', label: 'Date', group: 'input',
    holdsValue: true, supportsLength: false, supportsChoices: false,
  },
  dropdown_select: {
    type: 'dropdown_select', label: 'Dropdown select', group: 'input',
    holdsValue: true, supportsLength: false, supportsChoices: true,
  },
  heading: {
    type: 'heading', label: 'Heading', group: 'section',
    holdsValue: false, supportsLength: false, supportsChoices: false,
  },
  guidelines: {
    type: 'guidelines', label: 'Guidelines', group: 'section',
    holdsValue: false, supportsLength: false, supportsChoices: false,
  },
};

/**
 * Values are ALWAYS arrays for these types, even when a single option is
 * selected or one file uploaded — matching EasyContent's published API, and
 * worth copying so the shape never changes underneath a consumer.
 */
export const ARRAY_VALUED_TYPES: readonly FieldType[] = [
  'file_image_upload',
  'checkboxes',
  'dropdown_select',
];
