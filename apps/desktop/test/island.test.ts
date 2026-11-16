import { describe, expect, it } from 'vitest';
import { plain } from '../src/renderer/src/shell/island-text';

describe('island text', () => {
  it('leaves code blocks and Markdown marks out', () => {
    const text =
      'README bir **sahte proje** anlatıyor.\n\n```powershell\nGet-ChildItem -Recurse\n```\n\n- İstek: _not_\n- Test: `14 passed`';
    expect(plain(text)).toBe('README bir sahte proje anlatıyor.\n\n- İstek: not\n- Test: 14 passed');
  });

  it('drops an unfinished code block of a streaming answer', () => {
    expect(plain('Komut:\n```bash\nnpm te')).toBe('Komut:');
  });

  it('keeps underscores inside words and list stars', () => {
    expect(plain('snake_case_name\n* madde')).toBe('snake_case_name\n* madde');
  });
});
