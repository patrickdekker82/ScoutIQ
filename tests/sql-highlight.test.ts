import { describe, expect, it } from 'vitest';
import { highlight } from '@/components/sql-console';

/**
 * SQL highlighting (§23).
 *
 * The output is injected as HTML, so the escaping is the part that matters:
 * a query is user input and must never become markup.
 */
describe('highlight', () => {
  it('marks keywords, strings, numbers and comments', () => {
    const html = highlight("SELECT * FROM players WHERE minutes > 450 -- only regulars\n");

    expect(html).toContain('<span class="sql-keyword">SELECT</span>');
    expect(html).toContain('<span class="sql-keyword">FROM</span>');
    expect(html).toContain('<span class="sql-number">450</span>');
    expect(html).toContain('<span class="sql-comment">-- only regulars</span>');
  });

  it('handles two-word keywords', () => {
    expect(highlight('ORDER BY x')).toContain('<span class="sql-keyword">ORDER BY</span>');
    expect(highlight('GROUP  BY x')).toContain('sql-keyword');
  });

  it('escapes markup before adding any of its own', () => {
    const html = highlight("SELECT '<script>alert(1)</script>' AS x");

    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('escapes ampersands and angle brackets in comparisons', () => {
    const html = highlight('SELECT * FROM t WHERE a < 5 AND b > 2');

    expect(html).toContain('&lt;');
    expect(html).toContain('&gt;');
  });

  it('leaves an empty query alone', () => {
    expect(highlight('')).toBe('');
  });

  it('does not highlight a keyword inside an identifier', () => {
    // "selection" must not become "<span>select</span>ion".
    expect(highlight('SELECT selection FROM t')).not.toContain('>ion');
  });
});
