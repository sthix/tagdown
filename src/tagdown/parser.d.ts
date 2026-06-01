export function tagdown(input: string): string;

export namespace tagdown {
  function state(): {
    frontmatter: string | null;
    footnotes: Array<{ id: string; text: string }>;
    headings: Array<{ level: number; text: string; id: string }>;
    tabsCounter: number;
  };
}
