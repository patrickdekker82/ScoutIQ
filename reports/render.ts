import { PITCH_LENGTH_M, PITCH_WIDTH_M } from '@/analytics/coordinates';
import { humanise, type Block } from '@/reports/blocks';
import type { SnapshotMeta } from '@/reports/snapshot';

/**
 * HTML renderer for reports (§51).
 *
 * Produces a self-contained A4 document. Charts, radars, heatmaps and shot maps
 * are inline SVG built from the data - not screenshots (§51) - so the PDF is
 * vector, searchable and reproducible from the frozen snapshot.
 */

export interface RenderOptions {
  organisation: string;
  logoDataUri?: string | undefined;
  baseUrl: string;
  meta: SnapshotMeta;
  methodology?: string;
}

const escapeHtml = (value: unknown): string =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const percent = (value: number): string => `${(value * 100).toFixed(1)}%`;

const number = (value: unknown, decimals = 2): string =>
  typeof value === 'number' && Number.isFinite(value) ? value.toFixed(decimals) : '-';

/** Radar chart for the DNA categories. Takes an ORDERED list (see blocks.ts). */
function renderRadar(dna: { category: string; score: number }[]): string {
  const entries = dna
    .filter((entry) => typeof entry.score === 'number')
    .map((entry) => [entry.category, entry.score] as const);
  if (entries.length < 3) return '<p class="muted">Not enough categories for a radar.</p>';

  const size = 320;
  const centre = size / 2;
  const radius = centre - 54;
  const step = (Math.PI * 2) / entries.length;

  const point = (index: number, value: number): [number, number] => {
    const angle = index * step - Math.PI / 2;
    const distance = (Math.max(0, Math.min(100, value)) / 100) * radius;
    return [centre + Math.cos(angle) * distance, centre + Math.sin(angle) * distance];
  };

  const rings = [25, 50, 75, 100]
    .map((level) => {
      const points = entries
        .map((_, index) => point(index, level).join(','))
        .join(' ');
      return `<polygon points="${points}" fill="none" stroke="#d8dee9" stroke-width="1"/>`;
    })
    .join('');

  const shape = entries.map(([, value], index) => point(index, value).join(',')).join(' ');

  const labels = entries
    .map(([category, value], index) => {
      const angle = index * step - Math.PI / 2;
      const x = centre + Math.cos(angle) * (radius + 26);
      const y = centre + Math.sin(angle) * (radius + 26);
      const anchor = Math.abs(Math.cos(angle)) < 0.3 ? 'middle' : Math.cos(angle) > 0 ? 'start' : 'end';
      return `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="${anchor}" class="radar-label">${escapeHtml(
        category,
      )} <tspan class="radar-value">${value.toFixed(0)}</tspan></text>`;
    })
    .join('');

  return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img">
    ${rings}
    <polygon points="${shape}" fill="rgba(27,94,160,0.22)" stroke="#1b5ea0" stroke-width="2"/>
    ${labels}
  </svg>`;
}

/** Pitch outline shared by the heatmap and the shot map. */
function pitchMarkings(): string {
  return `
    <rect x="0" y="0" width="${PITCH_LENGTH_M}" height="${PITCH_WIDTH_M}" fill="none" stroke="#94a3b8" stroke-width="0.4"/>
    <line x1="${PITCH_LENGTH_M / 2}" y1="0" x2="${PITCH_LENGTH_M / 2}" y2="${PITCH_WIDTH_M}" stroke="#94a3b8" stroke-width="0.4"/>
    <circle cx="${PITCH_LENGTH_M / 2}" cy="${PITCH_WIDTH_M / 2}" r="9.15" fill="none" stroke="#94a3b8" stroke-width="0.4"/>
    <rect x="0" y="13.84" width="16.5" height="40.32" fill="none" stroke="#94a3b8" stroke-width="0.4"/>
    <rect x="${PITCH_LENGTH_M - 16.5}" y="13.84" width="16.5" height="40.32" fill="none" stroke="#94a3b8" stroke-width="0.4"/>
    <rect x="0" y="24.84" width="5.5" height="18.32" fill="none" stroke="#94a3b8" stroke-width="0.3"/>
    <rect x="${PITCH_LENGTH_M - 5.5}" y="24.84" width="5.5" height="18.32" fill="none" stroke="#94a3b8" stroke-width="0.3"/>`;
}

function renderHeatmap(heatmap: {
  cols: number;
  rows: number;
  cells: { x: number; y: number; value: number }[];
}): string {
  const cellWidth = PITCH_LENGTH_M / heatmap.cols;
  const cellHeight = PITCH_WIDTH_M / heatmap.rows;

  const cells = heatmap.cells
    .filter((cell) => cell.value > 0.02)
    .map((cell) => {
      const opacity = Math.min(0.85, cell.value * 0.85);
      return `<rect x="${(cell.x - cellWidth / 2).toFixed(2)}" y="${(cell.y - cellHeight / 2).toFixed(2)}" width="${cellWidth.toFixed(2)}" height="${cellHeight.toFixed(2)}" fill="#1b5ea0" opacity="${opacity.toFixed(3)}"/>`;
    })
    .join('');

  return `<svg viewBox="0 0 ${PITCH_LENGTH_M} ${PITCH_WIDTH_M}" class="pitch" role="img">
    <rect x="0" y="0" width="${PITCH_LENGTH_M}" height="${PITCH_WIDTH_M}" fill="#f8fafc"/>
    ${cells}
    ${pitchMarkings()}
  </svg>`;
}

function renderShotMap(
  shots: { x: number; y: number; xg: number; isGoal: boolean; onTarget: boolean }[],
): string {
  const markers = shots
    .map((shot) => {
      const radius = Math.max(0.8, Math.sqrt(Math.max(0.01, shot.xg)) * 4);
      const fill = shot.isGoal ? '#16a34a' : shot.onTarget ? '#f59e0b' : '#94a3b8';
      return `<circle cx="${shot.x.toFixed(2)}" cy="${shot.y.toFixed(2)}" r="${radius.toFixed(2)}" fill="${fill}" fill-opacity="0.75" stroke="#1f2937" stroke-width="0.15"/>`;
    })
    .join('');

  return `<svg viewBox="52 0 ${PITCH_LENGTH_M - 52} ${PITCH_WIDTH_M}" class="pitch" role="img">
    <rect x="52" y="0" width="${PITCH_LENGTH_M - 52}" height="${PITCH_WIDTH_M}" fill="#f8fafc"/>
    ${pitchMarkings()}
    ${markers}
  </svg>
  <p class="legend"><span class="dot goal"></span> Goal <span class="dot ontarget"></span> On target <span class="dot off"></span> Off target - marker size is xG</p>`;
}

function renderPercentileBars(
  percentiles: { metricKey: string; value: number; percentile: number }[],
): string {
  return percentiles
    .slice(0, 16)
    .map((entry) => {
      const width = Math.max(1, Math.min(100, entry.percentile));
      const tone = entry.percentile >= 70 ? 'high' : entry.percentile >= 40 ? 'mid' : 'low';
      return `<tr>
        <td class="metric">${escapeHtml(humanise(entry.metricKey))}</td>
        <td class="value">${number(entry.value)}</td>
        <td class="bar-cell">
          <div class="bar"><div class="bar-fill ${tone}" style="width:${width.toFixed(1)}%"></div></div>
        </td>
        <td class="pct">${entry.percentile.toFixed(0)}</td>
      </tr>`;
    })
    .join('');
}

function renderBlock(block: Block): string {
  const content = block.content as Record<string, unknown>;

  switch (block.type) {
    case 'TITLE':
      return '';

    case 'EXECUTIVE_SUMMARY':
      return section(block.title, `<p class="lead">${escapeHtml(content.text)}</p>`);

    case 'IDENTITY': {
      const rows: [string, unknown][] = [
        ['Position', content.position],
        ['Position group', content.positionGroup],
        ['Age', content.age],
        ['Nationality', content.nationality],
        ['Preferred foot', content.preferredFoot],
        ['Height', content.heightCm ? `${content.heightCm} cm` : null],
        ['Club', content.teamName],
      ];
      return section(
        block.title,
        `<dl class="identity">${rows
          .filter(([, value]) => value !== null && value !== undefined && value !== '')
          .map(
            ([label, value]) =>
              `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`,
          )
          .join('')}</dl>`,
      );
    }

    case 'KEY_METRICS': {
      const metrics = (content.metrics ?? []) as { key: string; value: number }[];
      const cells = metrics
        .slice(0, 12)
        .map(
          (entry) =>
            `<div class="stat"><span class="stat-value">${number(entry.value)}</span><span class="stat-label">${escapeHtml(
              humanise(entry.key),
            )}</span></div>`,
        )
        .join('');
      return section(block.title, `<div class="stats">${cells}</div>`);
    }

    case 'PERCENTILES':
      return section(
        block.title,
        `<p class="muted">Population: ${escapeHtml(content.population)}</p>
         <table class="percentiles"><thead><tr><th>Metric</th><th>Value</th><th>Percentile</th><th></th></tr></thead>
         <tbody>${renderPercentileBars(
           content.percentiles as { metricKey: string; value: number; percentile: number }[],
         )}</tbody></table>`,
      );

    case 'RADAR':
      return section(
        block.title,
        `<div class="radar">${renderRadar(content.dna as { category: string; score: number }[])}</div>`,
      );

    case 'HEATMAP':
      return section(
        block.title,
        renderHeatmap(
          content.heatmap as { cols: number; rows: number; cells: { x: number; y: number; value: number }[] },
        ),
      );

    case 'SHOT_MAP':
      return section(
        block.title,
        renderShotMap(
          content.shots as { x: number; y: number; xg: number; isGoal: boolean; onTarget: boolean }[],
        ),
      );

    case 'TACTICAL_PROFILE': {
      const roles = content.roles as {
        roleName: string;
        score: number;
        isPrimary: boolean;
      }[];
      return section(
        block.title,
        `<table class="roles"><thead><tr><th>Role</th><th>Score</th></tr></thead><tbody>${roles
          .map(
            (role) =>
              `<tr class="${role.isPrimary ? 'primary' : ''}"><td>${escapeHtml(role.roleName)}${
                role.isPrimary ? ' <span class="tag">primary</span>' : ''
              }</td><td>${role.score.toFixed(1)}</td></tr>`,
          )
          .join('')}</tbody></table>`,
      );
    }

    case 'STRENGTHS':
    case 'RISKS': {
      const items = content.items as string[];
      if (items.length === 0) return '';
      return section(
        block.title,
        `<ul class="bullets">${items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`,
      );
    }

    case 'CLUB_FIT': {
      const fits = content.fits as { teamName: string; fitScore: number }[];
      return section(
        block.title,
        `<table class="fits"><thead><tr><th>Club</th><th>Fit</th></tr></thead><tbody>${fits
          .map(
            (fit) =>
              `<tr><td>${escapeHtml(fit.teamName)}</td><td>${fit.fitScore.toFixed(0)}%</td></tr>`,
          )
          .join('')}</tbody></table>
        <p class="muted">Analytical model output based on style percentiles - not objective truth.</p>`,
      );
    }

    case 'COMPARABLE_PLAYERS': {
      const players = content.players as {
        playerName: string;
        teamName: string | null;
        similarity: number;
      }[];
      return section(
        block.title,
        `<table class="similar"><thead><tr><th>Player</th><th>Club</th><th>Similarity</th></tr></thead><tbody>${players
          .map(
            (entry) =>
              `<tr><td>${escapeHtml(entry.playerName)}</td><td>${escapeHtml(
                entry.teamName ?? '-',
              )}</td><td>${percent(entry.similarity)}</td></tr>`,
          )
          .join('')}</tbody></table>`,
      );
    }

    case 'SCOUT_NOTES': {
      const notes = content.notes as {
        author: string;
        createdAt: string;
        minute: number | null;
        body: string;
      }[];
      const ratings = content.ratings as {
        author: string;
        technical: number;
        tactical: number;
        physical: number;
        mental: number;
        potential: number;
        overall: number;
      }[];

      const noteHtml = notes
        .map(
          (note) =>
            `<li><strong>${escapeHtml(note.author)}</strong>${
              note.minute !== null ? ` <span class="muted">${note.minute}'</span>` : ''
            } - ${escapeHtml(note.body)}</li>`,
        )
        .join('');

      const ratingHtml = ratings
        .map(
          (rating) =>
            `<tr><td>${escapeHtml(rating.author)}</td><td>${rating.technical}</td><td>${rating.tactical}</td><td>${rating.physical}</td><td>${rating.mental}</td><td>${rating.potential}</td><td><strong>${rating.overall}</strong></td></tr>`,
        )
        .join('');

      return section(
        block.title,
        `${notes.length > 0 ? `<ul class="notes">${noteHtml}</ul>` : ''}
         ${
           ratings.length > 0
             ? `<table class="ratings"><thead><tr><th>Scout</th><th>Tec</th><th>Tac</th><th>Phy</th><th>Men</th><th>Pot</th><th>Overall</th></tr></thead><tbody>${ratingHtml}</tbody></table>
                <p class="muted">Human scouting judgement, kept separate from the analytical scores above.</p>`
             : ''
         }`,
      );
    }

    case 'RECOMMENDATION':
      return section(block.title, `<p class="lead">${escapeHtml(content.text)}</p>`);

    default:
      return section(block.title, `<pre>${escapeHtml(JSON.stringify(block.content, null, 2))}</pre>`);
  }
}

const section = (title: string | undefined, body: string): string =>
  `<section class="block">${title ? `<h2>${escapeHtml(title)}</h2>` : ''}${body}</section>`;

const STYLES = `
  @page { size: A4; margin: 18mm 14mm 20mm 14mm; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
         color: #0f172a; font-size: 10.5pt; line-height: 1.45; margin: 0; }
  header.cover { border-bottom: 3px solid #1b5ea0; padding-bottom: 14px; margin-bottom: 20px;
                 display: flex; justify-content: space-between; align-items: flex-end; }
  header.cover h1 { font-size: 22pt; margin: 0 0 4px; letter-spacing: -0.02em; }
  header.cover .subject { font-size: 13pt; color: #334155; margin: 0; }
  header.cover .org { text-align: right; font-size: 9pt; color: #64748b; }
  header.cover img { max-height: 44px; }
  .demo-banner { background: #fef3c7; border: 1px solid #f59e0b; color: #92400e;
                 padding: 6px 10px; border-radius: 4px; font-weight: 600; margin-bottom: 14px;
                 font-size: 9.5pt; letter-spacing: 0.04em; }
  .block { margin-bottom: 18px; break-inside: avoid; }
  .block h2 { font-size: 12pt; margin: 0 0 8px; padding-bottom: 4px;
              border-bottom: 1px solid #e2e8f0; color: #1b5ea0; }
  .lead { margin: 0; }
  .muted { color: #64748b; font-size: 9pt; }
  dl.identity { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px 16px; margin: 0; }
  dl.identity dt { font-size: 8.5pt; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em; }
  dl.identity dd { margin: 0; font-weight: 600; }
  .stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
  .stat { background: #f1f5f9; border-radius: 4px; padding: 8px; text-align: center; }
  .stat-value { display: block; font-size: 14pt; font-weight: 700; color: #1b5ea0; }
  .stat-label { display: block; font-size: 8pt; color: #64748b; }
  table { width: 100%; border-collapse: collapse; font-size: 9.5pt; }
  th { text-align: left; font-size: 8.5pt; text-transform: uppercase; letter-spacing: 0.04em;
       color: #64748b; border-bottom: 1px solid #e2e8f0; padding: 4px 6px; }
  td { padding: 4px 6px; border-bottom: 1px solid #f1f5f9; }
  td.metric { width: 34%; }
  td.value { width: 12%; text-align: right; font-variant-numeric: tabular-nums; }
  td.pct { width: 8%; text-align: right; font-weight: 700; font-variant-numeric: tabular-nums; }
  .bar { background: #e2e8f0; border-radius: 3px; height: 9px; width: 100%; }
  .bar-fill { height: 9px; border-radius: 3px; }
  .bar-fill.high { background: #16a34a; }
  .bar-fill.mid { background: #f59e0b; }
  .bar-fill.low { background: #cbd5e1; }
  .radar { text-align: center; }
  .radar svg { max-height: 92mm; width: auto; }
  .radar-label { font-size: 7.5px; fill: #334155; }
  .radar-value { font-weight: 700; fill: #1b5ea0; }
  /* Cap the pitch height so a heatmap never claims a whole A4 page. */
  svg.pitch { width: 100%; max-height: 92mm; height: auto; border: 1px solid #e2e8f0;
              border-radius: 4px; display: block; }
  .legend { font-size: 8.5pt; color: #64748b; margin-top: 4px; }
  .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin: 0 3px 0 10px; }
  .dot.goal { background: #16a34a; } .dot.ontarget { background: #f59e0b; } .dot.off { background: #94a3b8; }
  .tag { background: #1b5ea0; color: #fff; font-size: 7.5pt; padding: 1px 5px; border-radius: 3px; }
  tr.primary td { font-weight: 700; }
  ul.bullets, ul.notes { margin: 0; padding-left: 18px; }
  ul.notes li { margin-bottom: 4px; }
  footer.meta { margin-top: 24px; padding-top: 10px; border-top: 1px solid #e2e8f0;
                font-size: 8pt; color: #64748b; break-inside: avoid; }
  footer.meta h3 { font-size: 9pt; color: #334155; margin: 0 0 4px; }
  footer.meta ul { margin: 0 0 8px; padding-left: 16px; }
`;

export interface RenderInput {
  title: string;
  subject: string;
  subtitle?: string | undefined;
  isDemo: boolean;
  blocks: Block[];
  quality: { minutes: number; matches: number; confidence: string; summary: string };
}

export function renderReportHtml(input: RenderInput, options: RenderOptions): string {
  const body = input.blocks.map(renderBlock).join('\n');

  const providers = options.meta.providerVersions
    .map(
      (provider) =>
        `<li>${escapeHtml(provider.name)} (${escapeHtml(provider.version)})${
          provider.licenceName ? ` - ${escapeHtml(provider.licenceName)}` : ''
        }</li>`,
    )
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(input.title)}</title>
<style>${STYLES}</style>
</head>
<body>
  <header class="cover">
    <div>
      <h1>${escapeHtml(input.title)}</h1>
      <p class="subject">${escapeHtml(input.subject)}${
        input.subtitle ? ` &middot; ${escapeHtml(input.subtitle)}` : ''
      }</p>
    </div>
    <div class="org">
      ${options.logoDataUri ? `<img src="${options.logoDataUri}" alt="">` : ''}
      <div>${escapeHtml(options.organisation)}</div>
      <div>${escapeHtml(options.meta.generatedAt.slice(0, 10))}</div>
    </div>
  </header>

  ${input.isDemo ? '<div class="demo-banner">DEMO DATA - fabricated content for demonstration only</div>' : ''}

  ${body}

  <footer class="meta">
    <h3>Data sources</h3>
    <ul>${providers || '<li>No provider imports recorded.</li>'}</ul>

    <h3>Data quality</h3>
    <p>${escapeHtml(input.quality.summary)}</p>

    <h3>Methodology</h3>
    <p>${escapeHtml(
      options.methodology ??
        'Percentile ranks are computed within the same competition season and position group. ' +
          'Player DNA and role scores are weighted averages of those percentiles; each score stores ' +
          'the metrics, weights and sample size that produced it. Club fit compares a player style ' +
          'vector with a team style vector and is a model output, not objective truth.',
    )}</p>

    <p>
      Analytics version: ${escapeHtml(options.meta.analyticsVersion)} &middot;
      Report version: ${escapeHtml(options.meta.reportVersion)} &middot;
      Data snapshot: ${escapeHtml(options.meta.dataSnapshotId)}
    </p>
    <p>Generated by ScoutIQ - ${escapeHtml(options.baseUrl)}</p>
  </footer>
</body>
</html>`;
}
