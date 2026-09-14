/**
 * Mock content item, shaped exactly as the real API will return it.
 *
 * The structure mirrors the schema: an item has a template, the template has
 * tabs, tabs have fields, and each field carries its own value plus its
 * configuration (guidelines, recommended length, choices).
 *
 * When the API lands, this file is deleted and the same shape arrives over the
 * wire. Nothing else changes.
 *
 * Everything here is INVENTED placeholder content — no real articles, no real
 * people, no customer data. Names match the seeded development users so the
 * mock and the database tell the same story. Keep it that way: fixtures get
 * copied, shared and committed, so they are the wrong place for anything real.
 */

export type FieldType =
  | 'single_line_text'
  | 'paragraph_text'
  | 'file_image_upload'
  | 'single_image'
  | 'checkboxes'
  | 'radio_buttons'
  | 'dropdown_select'
  | 'date'
  | 'heading'
  | 'guidelines';

export interface ContentField {
  id: string;
  type: FieldType;
  label: string;
  /** Helper text shown beneath the field in grey. */
  guidelines?: string;
  isRequired?: boolean;
  isSystem?: boolean;
  /** Advisory only — passing it turns the counter red but blocks nothing. */
  recommendedLength?: number;
  recommendedLengthUnits?: 'words' | 'characters';
  /** Paragraph-text fields with this set render a plain textarea, not the
   *  full rich editor. This is the "Plain text" toggle from the template. */
  isPlainText?: boolean;
  /** Options for checkboxes / radio / select. */
  choices?: string[];
  /** Unresolved comments anchored to this field. */
  commentCount?: number;
  value: unknown;
}

export interface ContentTab {
  id: string;
  name: string;
  fields: ContentField[];
}

export interface UploadedFile {
  id: string;
  name: string;
  sizeKb: number;
  format: string;
  uploadedAt: string;
  uploadedBy: string;
  uploaderRole: string;
}

export interface StatusAssignee {
  initials: string;
  name: string;
  role: string;
  /** Whether this person has recorded their review at this status. */
  hasReviewed: boolean;
}

export interface WorkflowStatus {
  id: string;
  name: string;
  color: string;
  /** Freezes the item: nobody can edit, whatever their permissions. */
  readOnly: boolean;
  /** Item has already passed through this status. */
  isComplete: boolean;
  assignees: StatusAssignee[];
}

/** The brief an item was created from. Carried forward after conversion. */
export interface Brief {
  title: string;
  keywords: string[];
  description: string;
}

export interface ContentItem {
  id: number;
  name: string;
  projectName: string;
  templateName: string;
  categories: string[];
  brief: Brief;
  /** The whole ladder, not just the current status — an item carries
   *  assignees for every status, and the rail renders all of them. */
  workflow: WorkflowStatus[];
  currentStatusId: string;
  tabs: ContentTab[];
  files: UploadedFile[];
}

export const MOCK_ITEM: ContentItem = {
  id: 412,
  name: 'How to Choose a Standing Desk That Suits Your Work',
  projectName: 'Blog',
  templateName: 'Blog',
  categories: ['Guides & How-To'],
  brief: {
    // The leading number is a naming convention typed by the team, not a
    // generated id. The item's real id is the integer above.
    title: '202607200412 - standing desk buying guide',
    keywords: ['standing desk guide', 'adjustable desk height', 'sit stand desk'],
    description:
      'Readers want a practical guide to choosing and setting up a standing desk without buying the wrong height.',
  },
  currentStatusId: 'st-editorial',
  workflow: [
    {
      id: 'st-draft', name: 'Draft', color: '#ef4444',
      readOnly: false, isComplete: true,
      assignees: [
        { initials: 'AQ', name: 'Abuzar Qureshi', role: 'Writer', hasReviewed: true },
      ],
    },
    {
      id: 'st-editorial', name: 'Editorial Review', color: '#eab308',
      readOnly: false, isComplete: false,
      assignees: [
        { initials: 'IR', name: 'Ishita Rao', role: 'Editor', hasReviewed: false },
        { initials: 'PS', name: 'Priya Sharma', role: 'Admin', hasReviewed: false },
      ],
    },
    {
      id: 'st-approved', name: 'Approved for Publishing', color: '#22c55e',
      readOnly: true, isComplete: false,
      assignees: [
        { initials: 'PS', name: 'Priya Sharma', role: 'Admin', hasReviewed: false },
      ],
    },
    {
      id: 'st-completed', name: 'Completed', color: '#9ca3af',
      readOnly: true, isComplete: false,
      assignees: [],
    },
  ],
  files: [
    { id: 'f1', name: 'desk-height-guide.webp', sizeKb: 314, format: 'WEBP',
      uploadedAt: '1 month ago', uploadedBy: 'Abuzar Qureshi', uploaderRole: 'Writer' },
    { id: 'f2', name: 'workspace-layout.webp', sizeKb: 279, format: 'WEBP',
      uploadedAt: '1 month ago', uploadedBy: 'Abuzar Qureshi', uploaderRole: 'Writer' },
    { id: 'f3', name: 'cable-management.webp', sizeKb: 294, format: 'WEBP',
      uploadedAt: '3 weeks ago', uploadedBy: 'Ishita Rao', uploaderRole: 'Editor' },
    { id: 'f4', name: 'monitor-arm-setup.webp', sizeKb: 456, format: 'WEBP',
      uploadedAt: '3 weeks ago', uploadedBy: 'Ishita Rao', uploaderRole: 'Editor' },
  ],
  tabs: [
    {
      id: 'tab-main',
      name: 'Main Content',
      fields: [
        {
          id: 'f-title',
          type: 'single_line_text',
          label: 'Title',
          isSystem: true,
          isRequired: true,
          guidelines: 'Enter a catchy and descriptive title for your blog post.',
          recommendedLength: 50,
          recommendedLengthUnits: 'characters',
          commentCount: 1,
          value: 'How to Choose a Standing Desk That Suits Your Work',
        },
        {
          id: 'f-intro',
          type: 'paragraph_text',
          label: 'Introduction',
          guidelines:
            'Write a brief introduction that hooks the reader and gives an overview of the post. It will be displayed on the listing page.',
          recommendedLength: 100,
          recommendedLengthUnits: 'words',
          value: '',
        },
        {
          id: 'f-content',
          type: 'paragraph_text',
          label: 'Content',
          isSystem: true,
          isRequired: true,
          guidelines:
            'Write the main body of your blog post. Use headings, bullet points, and images as needed to enhance readability.',
          commentCount: 2,
          value: `<p>Placeholder copy for development. Replace freely — nothing here is real content, and this whole file disappears once the editor reads from the API.</p>
<p>A standing desk only helps if the height suits you. Too high and your shoulders creep up; too low and you lean. Most people get this wrong on the first try and never adjust it again.</p>
<h2>Measuring Your Working Height</h2>
<p>Stand with your arms relaxed and bend your elbows to ninety degrees. The desk should meet your hands there. That is your number, and it rarely matches the factory default.</p>
<ul>
  <li>Elbows at ninety degrees, shoulders down</li>
  <li>Screen top roughly at eye level</li>
  <li>Wrists flat, not angled up</li>
</ul>
<h2>How Long to Actually Stand</h2>
<p>Alternating every thirty to sixty minutes beats standing all day. Standing still for hours is its own problem, not a fix for sitting.</p>
<h3>A Reasonable Starting Rhythm</h3>
<p>Sit for forty minutes, stand for twenty, and adjust from there based on what your back tells you by the afternoon.</p>`,
        },
        {
          id: 'f-files',
          type: 'file_image_upload',
          label: 'Files',
          isSystem: true,
          guidelines:
            'Upload a high-quality image that represents the blog post. Recommended size: 1200x800 pixels.',
          value: [],
        },
        {
          id: 'f-categories',
          type: 'checkboxes',
          label: 'Categories',
          choices: [
            'Travel Tips',
            'Destination Guides',
            'Cultural Insights',
            'Adventure Travel',
            'Family Vacations',
          ],
          value: [],
        },
        {
          id: 'f-author',
          type: 'single_line_text',
          label: 'Author Name',
          guidelines: 'Who wrote the blog',
          value: '',
        },
      ],
    },
    {
      id: 'tab-cms',
      name: 'CMS Fields',
      // The system CMS fields — these map to a CMS/WordPress post on publish.
      // System fields can be hidden but not deleted, hence isSystem.
      fields: [
        {
          id: 'f-featured',
          type: 'single_image',
          label: 'Featured Image',
          isSystem: true,
          guidelines: 'The main image for the post, shown on listings and social shares.',
          value: { url: '', alt: '' },
        },
        {
          id: 'f-excerpt',
          type: 'paragraph_text',
          label: 'Excerpt',
          isSystem: true,
          isPlainText: true,
          guidelines: 'A short summary shown on the listing page.',
          recommendedLength: 160,
          recommendedLengthUnits: 'characters',
          value: '',
        },
        {
          id: 'f-tags',
          type: 'single_line_text',
          label: 'Tags',
          isSystem: true,
          guidelines: 'Add relevant tags to help readers find your post. Separate tags with commas.',
          value: '',
        },
        {
          id: 'f-slug',
          type: 'single_line_text',
          label: 'Custom Post Slug',
          isSystem: true,
          guidelines: 'The URL path for this post. Leave blank to generate one from the title.',
          value: '',
        },
        {
          id: 'f-meta-title',
          type: 'single_line_text',
          label: 'Meta Title',
          isSystem: true,
          guidelines:
            'The title shown in search results. Keep it within 50–60 characters.',
          recommendedLength: 60,
          recommendedLengthUnits: 'characters',
          value: '',
        },
        {
          id: 'f-meta-desc',
          type: 'paragraph_text',
          label: 'Meta Description',
          isSystem: true,
          isPlainText: true,
          guidelines:
            'A brief description for search results. Keep it within 150–160 characters.',
          recommendedLength: 150,
          recommendedLengthUnits: 'characters',
          value: '',
        },
      ],
    },
  ],
};
