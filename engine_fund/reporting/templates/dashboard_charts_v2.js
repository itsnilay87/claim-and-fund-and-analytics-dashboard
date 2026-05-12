/* Dashboard V2 - D3.js Chart Rendering Functions
 * Features:
 * - Grouped data tables with visual organization
 * - Blue-dominant color scheme
 * - Increased chart heights for better visibility
 * - X-axis at Y=0 for cash flow charts
 * - Interactive cursor with dotted tracker lines and value display
 * - Improved text positioning to avoid overlaps
 */

// ============================================================================
// Data parsing and initialization
// ============================================================================

const jCurveData = JSON.parse(document.getElementById('j-curve-data').textContent);
const irrData = JSON.parse(document.getElementById('irr-data').textContent);
const metadataData = JSON.parse(document.getElementById('metadata-data').textContent);
const metricsData = JSON.parse(document.getElementById('metrics-data').textContent);
const sensitivityData = JSON.parse(document.getElementById('sensitivity-data').textContent);
const navData = JSON.parse(document.getElementById('nav-data').textContent);
const alphaCashflowData = JSON.parse(document.getElementById('alpha-cashflow-data').textContent);
const simulationStatsData = JSON.parse(document.getElementById('simulation-stats-data').textContent);
const simulationDistributionsData = JSON.parse(document.getElementById('simulation-distributions-data').textContent);

// ============================================================================
// Color palette (blue-dominant)
// ============================================================================

const colors = {
  primary: '#3b82f6',
  secondary: '#60a5fa',
  tertiary: '#93c5fd',
  dark: '#1e3a8a',
  teal: '#22d3ee',
  amber: '#fbbf24',
  red: '#f87171',
  green: '#34d399',
  purple: '#a78bfa',
  text: '#f0f4fc',
  textSecondary: 'rgba(240, 244, 252, 0.75)',
  textMuted: 'rgba(240, 244, 252, 0.55)',
  grid: 'rgba(59, 130, 246, 0.08)',
  axis: 'rgba(59, 130, 246, 0.25)',
};

// ============================================================================
// Formatters
// ============================================================================

const formatters = {
  currency: (value) => value == null ? '—' : `${d3.format(',.2f')(value / 1e7)} Cr`,
  months: (value) => value == null ? '—' : `${d3.format(',.0f')(value)} mo`,
  percent: (value) => value == null ? '—' : `${d3.format(',.1f')(value)}%`,
  ratio: (value) => value == null ? '—' : d3.format(',.2f')(value),
  number: (value) => value == null ? '—' : d3.format(',.2f')(value),
};

const axisFormatters = {
  currency: (value) => `${d3.format(',.1f')(value / 1e7)} Cr`,
  months: (value) => d3.format(',.0f')(value),
  percent: (value) => `${d3.format(',.1f')(value)}%`,
  ratio: (value) => d3.format(',.2f')(value),
  number: (value) => d3.format(',.2f')(value),
};

const formatterFor = (format) => formatters[format] || formatters.number;
const axisFormatterFor = (format) => axisFormatters[format] || axisFormatters.number;

// ============================================================================
// Utility functions
// ============================================================================

const expandDomain = (domain, paddingFraction = 0.05) => {
  if (domain[0] === undefined || domain[1] === undefined) {
    return domain;
  }
  if (domain[0] === domain[1]) {
    const padding = domain[0] === 0 ? 1 : Math.abs(domain[0]) * paddingFraction || 1;
    return [domain[0] - padding, domain[1] + padding];
  }
  const span = domain[1] - domain[0];
  const padding = span * paddingFraction;
  return [domain[0] - padding, domain[1] + padding];
};

const parseISODate = d3.utcParse('%Y-%m-%d');

function smoothSeries(series, windowSize = 5) {
  if (!Array.isArray(series) || !series.length || windowSize <= 1) {
    return series;
  }

  const halfWindow = Math.floor(windowSize / 2);
  return series.map((point, index) => {
    let sum = 0;
    let count = 0;
    const start = Math.max(0, index - halfWindow);
    const end = Math.min(series.length - 1, index + halfWindow);
    for (let i = start; i <= end; i += 1) {
      const value = series[i].value;
      if (Number.isFinite(value)) {
        sum += value;
        count += 1;
      }
    }
    const average = count ? sum / count : point.value;
    return { ...point, value: average };
  });
}

// ============================================================================
// Tooltip management
// ============================================================================

const tooltip = d3.select('#chart-tooltip');

function showTooltip(content, x, y) {
  tooltip
    .html(content)
    .style('left', `${x + 15}px`)
    .style('top', `${y - 10}px`)
    .classed('visible', true);
}

function hideTooltip() {
  tooltip.classed('visible', false);
}

function positionTooltip(event) {
  const tooltipNode = tooltip.node();
  const rect = tooltipNode.getBoundingClientRect();
  const windowWidth = window.innerWidth;
  const windowHeight = window.innerHeight;
  
  let x = event.pageX + 15;
  let y = event.pageY - 10;
  
  // Prevent tooltip from going off screen
  if (x + rect.width > windowWidth - 20) {
    x = event.pageX - rect.width - 15;
  }
  if (y + rect.height > windowHeight - 20) {
    y = event.pageY - rect.height - 10;
  }
  if (y < 10) {
    y = 10;
  }
  
  tooltip
    .style('left', `${x}px`)
    .style('top', `${y}px`);
}

// ============================================================================
// Grouped Table Rendering
// ============================================================================

// Group definitions for metrics and metadata
const metricGroups = {
  'Return Metrics': ['net_annualised_irr_pct', 'roic_multiple', 'moic', 'dpi', 'tvpi', 'rvpi'],
  'Capital Metrics': ['total_commitment', 'capital_called', 'capital_returned', 'net_cashflow'],
  'Performance': ['fund_term_months', 'investment_period_months', 'harvesting_period_months'],
  'Other': [],
};

const metadataGroups = {
  'Fund Information': ['fund_name', 'fund_currency', 'launch_date', 'close_date', 'fund_term'],
  'Capital Structure': ['target_fund_size', 'sponsor_commitment', 'anchor_commitment', 'lp_commitment'],
  'Fee Structure': ['management_fee', 'carried_interest', 'hurdle_rate', 'catch_up'],
  'Investment Parameters': ['investment_period', 'harvest_period', 'deployment_pace'],
  'Other': [],
};

function categorizeItems(data, groupDefinitions) {
  const grouped = {};
  const usedKeys = new Set();
  
  // Initialize groups
  Object.keys(groupDefinitions).forEach(group => {
    grouped[group] = [];
  });
  
  // Assign items to predefined groups
  data.forEach(item => {
    const keyLower = item.key.toLowerCase().replace(/\s+/g, '_');
    let assigned = false;
    
    for (const [groupName, keys] of Object.entries(groupDefinitions)) {
      if (keys.some(k => keyLower.includes(k) || k.includes(keyLower))) {
        grouped[groupName].push(item);
        usedKeys.add(item.key);
        assigned = true;
        break;
      }
    }
    
    if (!assigned) {
      grouped['Other'].push(item);
    }
  });
  
  return grouped;
}

function renderGroupedTable(selector, data, groupDefinitions) {
  const table = d3.select(selector);
  table.selectAll('*').remove();

  if (!data.length) {
    const tbody = table.append('tbody');
    tbody.append('tr')
      .append('td')
      .attr('colspan', 2)
      .text('No data available');
    return;
  }

  const grouped = categorizeItems(data, groupDefinitions);
  const tbody = table.append('tbody');
  
  Object.entries(grouped).forEach(([groupName, items]) => {
    if (items.length === 0) return;
    
    // Group header row
    const headerRow = tbody.append('tr').attr('class', 'group-header');
    headerRow.append('td')
      .attr('colspan', 2)
      .text(groupName);
    
    // Data rows
    items.forEach(row => {
      const tr = tbody.append('tr');
      tr.append('td')
        .attr('class', 'key')
        .text(row.key.replace(/_/g, ' '));
      tr.append('td')
        .attr('class', 'value')
        .text(row.value);
    });
  });
}

function renderSimulationSummaryTable(data) {
  const table = d3.select('#simulation-summary-table');
  table.selectAll('*').remove();

  const columns = [
    { key: 'label', title: 'Metric', className: 'metric' },
    { key: 'alpha', title: 'Alpha' },
    { key: 'min', title: 'Min' },
    { key: 'p25', title: 'P25' },
    { key: 'median', title: 'Median' },
    { key: 'mean', title: 'Mean' },
    { key: 'p75', title: 'P75' },
    { key: 'max', title: 'Max' },
  ];

  if (!data.length) {
    const tbody = table.append('tbody');
    tbody.append('tr')
      .append('td')
      .attr('colspan', columns.length)
      .text('No simulations available');
    return;
  }

  const thead = table.append('thead');
  const headerRow = thead.append('tr');
  columns.forEach((column) => {
    headerRow.append('th')
      .attr('class', column.className || null)
      .text(column.title);
  });

  const tbody = table.append('tbody');
  data.forEach((row) => {
    const valueFormatter = formatterFor(row.format);
    const tr = tbody.append('tr');
    columns.forEach((column) => {
      const cell = tr.append('td').attr('class', column.className || null);
      if (column.key === 'label') {
        cell.text(row.label || row.metric);
      } else {
        cell.text(valueFormatter(row[column.key]));
      }
    });
  });
}

// ============================================================================
// Interactive cursor tracker
// ============================================================================

/**
 * Basic cursor tracker that follows mouse position (for histograms, etc.)
 */
function addCursorTracker(svg, g, x, y, innerWidth, innerHeight, formatX, formatY) {
  // Create cursor elements
  const cursorGroup = g.append('g').attr('class', 'cursor-tracker').style('display', 'none');
  
  const verticalLine = cursorGroup.append('line')
    .attr('class', 'cursor-line')
    .attr('y1', 0)
    .attr('y2', innerHeight);
  
  const horizontalLine = cursorGroup.append('line')
    .attr('class', 'cursor-line')
    .attr('x1', 0)
    .attr('x2', innerWidth);
  
  const xValueLabel = cursorGroup.append('text')
    .attr('class', 'cursor-label')
    .attr('text-anchor', 'middle')
    .attr('fill', colors.textSecondary)
    .attr('font-size', 10);
  
  const yValueLabel = cursorGroup.append('text')
    .attr('class', 'cursor-label')
    .attr('text-anchor', 'end')
    .attr('fill', colors.textSecondary)
    .attr('font-size', 10);
  
  // Overlay rect for mouse events
  const overlay = g.append('rect')
    .attr('class', 'overlay')
    .attr('width', innerWidth)
    .attr('height', innerHeight)
    .attr('fill', 'none')
    .attr('pointer-events', 'all');
  
  overlay
    .on('mouseenter', () => cursorGroup.style('display', null))
    .on('mouseleave', () => {
      cursorGroup.style('display', 'none');
      hideTooltip();
    })
    .on('mousemove', (event) => {
      const [mx, my] = d3.pointer(event);
      
      // Clamp to bounds
      const cx = Math.max(0, Math.min(innerWidth, mx));
      const cy = Math.max(0, Math.min(innerHeight, my));
      
      // Update cursor lines
      verticalLine.attr('x1', cx).attr('x2', cx);
      horizontalLine.attr('y1', cy).attr('y2', cy);
      
      // Get values at cursor position
      const xValue = x.invert(cx);
      const yValue = y.invert(cy);
      
      // Position labels with offset to avoid axis overlap
      xValueLabel
        .attr('x', cx)
        .attr('y', innerHeight + 28)
        .text(formatX(xValue));
      
      yValueLabel
        .attr('x', -8)
        .attr('y', cy + 4)
        .text(formatY(yValue));
    });
  
  return { overlay, cursorGroup };
}

/**
 * Line-following cursor tracker that snaps to a data series
 * @param {Object} options
 * @param {Array} options.data - Array of data points with date and value properties
 * @param {Function} options.xAccessor - Function to get x value (date) from data point
 * @param {Function} options.yAccessor - Function to get y value from data point
 * @param {d3.Scale} options.x - X scale
 * @param {d3.Scale} options.y - Y scale
 * @param {number} options.innerWidth - Chart inner width
 * @param {number} options.innerHeight - Chart inner height
 * @param {Function} options.formatX - X value formatter
 * @param {Function} options.formatY - Y value formatter
 * @param {string} options.lineColor - Color for the tracking point
 */
function addLineFollowingCursor(svg, g, options) {
  const {
    data,
    xAccessor,
    yAccessor,
    x,
    y,
    innerWidth,
    innerHeight,
    formatX,
    formatY,
    lineColor = colors.amber,
  } = options;

  // Bisector to find closest data point
  const bisectDate = d3.bisector(xAccessor).left;

  // Create cursor elements
  const cursorGroup = g.append('g').attr('class', 'cursor-tracker').style('display', 'none');
  
  const verticalLine = cursorGroup.append('line')
    .attr('class', 'cursor-line')
    .attr('y1', 0)
    .attr('y2', innerHeight);
  
  const horizontalLine = cursorGroup.append('line')
    .attr('class', 'cursor-line')
    .attr('x1', 0)
    .attr('x2', innerWidth);
  
  // Tracking circle on the line
  const trackingCircle = cursorGroup.append('circle')
    .attr('r', 6)
    .attr('fill', lineColor)
    .attr('stroke', colors.text)
    .attr('stroke-width', 2);

  // Value label background for readability
  const labelBg = cursorGroup.append('rect')
    .attr('fill', 'rgba(10, 15, 26, 0.9)')
    .attr('rx', 4)
    .attr('ry', 4);

  const valueLabel = cursorGroup.append('text')
    .attr('class', 'cursor-value-label')
    .attr('fill', colors.text)
    .attr('font-size', 11)
    .attr('font-weight', 500);

  const xValueLabel = cursorGroup.append('text')
    .attr('class', 'cursor-label')
    .attr('text-anchor', 'middle')
    .attr('fill', colors.textSecondary)
    .attr('font-size', 10);
  
  // Overlay rect for mouse events
  const overlay = g.append('rect')
    .attr('class', 'overlay')
    .attr('width', innerWidth)
    .attr('height', innerHeight)
    .attr('fill', 'none')
    .attr('pointer-events', 'all');
  
  overlay
    .on('mouseenter', () => cursorGroup.style('display', null))
    .on('mouseleave', () => {
      cursorGroup.style('display', 'none');
      hideTooltip();
    })
    .on('mousemove', (event) => {
      const [mx] = d3.pointer(event);
      
      // Clamp x to bounds
      const cx = Math.max(0, Math.min(innerWidth, mx));
      
      // Find closest data point
      const xDate = x.invert(cx);
      const index = bisectDate(data, xDate, 1);
      const d0 = data[index - 1];
      const d1 = data[index];
      
      let closestPoint;
      if (!d0) {
        closestPoint = d1;
      } else if (!d1) {
        closestPoint = d0;
      } else {
        closestPoint = xDate - xAccessor(d0) > xAccessor(d1) - xDate ? d1 : d0;
      }
      
      if (!closestPoint) return;
      
      const pointX = x(xAccessor(closestPoint));
      const yValue = yAccessor(closestPoint);
      
      if (yValue == null || !Number.isFinite(yValue)) return;
      
      const pointY = y(yValue);
      
      // Update cursor lines - vertical follows x, horizontal snaps to line value
      verticalLine.attr('x1', pointX).attr('x2', pointX);
      horizontalLine.attr('y1', pointY).attr('y2', pointY);
      
      // Position tracking circle on the line
      trackingCircle.attr('cx', pointX).attr('cy', pointY);
      
      // Format the value
      const formattedY = formatY(yValue);
      const formattedX = formatX(xAccessor(closestPoint));
      
      // Position value label near the point
      const labelX = pointX + 12;
      const labelY = pointY - 8;
      valueLabel
        .attr('x', labelX)
        .attr('y', labelY)
        .text(formattedY);
      
      // Add background to label
      const bbox = valueLabel.node().getBBox();
      labelBg
        .attr('x', bbox.x - 4)
        .attr('y', bbox.y - 2)
        .attr('width', bbox.width + 8)
        .attr('height', bbox.height + 4);
      
      // Position x label at bottom
      xValueLabel
        .attr('x', pointX)
        .attr('y', innerHeight + 28)
        .text(formattedX);
    });
  
  return { overlay, cursorGroup };
}

// ============================================================================
// Distribution Explorer
// ============================================================================

let currentDistributionMetric = null;

function renderDistributionExplorer(distributions) {
  const select = d3.select('#distribution-select');
  const svg = d3.select('#distribution-chart');
  select.selectAll('*').remove();

  const entries = Object.entries(distributions);
  if (!entries.length) {
    svg.selectAll('*').remove();
    const width = svg.node().clientWidth || 400;
    const height = svg.node().clientHeight || 380;
    svg.append('text')
      .attr('x', width / 2)
      .attr('y', height / 2)
      .attr('text-anchor', 'middle')
      .attr('fill', colors.textMuted)
      .attr('font-size', 14)
      .text('No distribution data available');
    return;
  }

  entries.forEach(([key, value]) => {
    select.append('option')
      .attr('value', key)
      .text(value.label || key.replace(/_/g, ' '));
  });

  if (!currentDistributionMetric || !distributions[currentDistributionMetric]) {
    currentDistributionMetric = entries[0][0];
  }

  select.property('value', currentDistributionMetric);
  select.on('change', (event) => {
    currentDistributionMetric = event.target.value;
    drawDistribution(currentDistributionMetric);
  });

  drawDistribution(currentDistributionMetric);

  function drawDistribution(metricKey) {
    const metric = distributions[metricKey];
    if (!metric) return;

    const histogram = metric.histogram || [];
    svg.selectAll('*').remove();

    const svgNode = svg.node();
    const container = svgNode.parentElement;
    const width = svgNode.clientWidth || container?.clientWidth || 640;
    const height = container?.classList.contains('chart-container') 
      ? container.clientHeight 
      : (svgNode.clientHeight || 380);
    const margin = { top: 20, right: 30, bottom: 50, left: 80 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;

    if (!histogram.length || innerHeight < 50) {
      svg.append('text')
        .attr('x', width / 2)
        .attr('y', height / 2)
        .attr('text-anchor', 'middle')
        .attr('fill', colors.textMuted)
        .attr('font-size', 14)
        .text('Distribution unavailable for this metric');
      return;
    }

    const xDomain = [
      d3.min(histogram, d => d.bin_start),
      d3.max(histogram, d => d.bin_end),
    ];
    const x = d3.scaleLinear()
      .domain(expandDomain(xDomain, 0.06))
      .range([0, innerWidth]);

    const y = d3.scaleLinear()
      .domain([0, d3.max(histogram, d => d.count) || 1])
      .nice()
      .range([innerHeight, 0]);

    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    // Grid lines
    g.append('g')
      .attr('class', 'grid')
      .selectAll('line')
      .data(y.ticks(5))
      .join('line')
      .attr('x1', 0)
      .attr('x2', innerWidth)
      .attr('y1', d => y(d))
      .attr('y2', d => y(d))
      .attr('stroke', colors.grid)
      .attr('stroke-dasharray', '2,4');

    // Histogram bars
    g.selectAll('rect')
      .data(histogram)
      .join('rect')
      .attr('x', d => x(d.bin_start))
      .attr('y', d => y(d.count))
      .attr('width', d => Math.max(1, x(d.bin_end) - x(d.bin_start) - 1))
      .attr('height', d => innerHeight - y(d.count))
      .attr('fill', colors.primary)
      .attr('opacity', 0.6);

    const xAxis = d3.axisBottom(x).ticks(6).tickFormat(axisFormatterFor(metric.format));
    const yAxis = d3.axisLeft(y).ticks(5).tickFormat(d3.format(',.0f'));

    g.append('g')
      .attr('transform', `translate(0,${innerHeight})`)
      .call(xAxis)
      .selectAll('text')
      .attr('fill', colors.textSecondary);

    g.append('g')
      .call(yAxis)
      .selectAll('text')
      .attr('fill', colors.textSecondary);

    // Marker lines
    const markers = [
      { key: 'mean', color: colors.primary, dash: '4,2', opacity: 1 },
      { key: 'median', color: colors.teal, dash: '4,2', opacity: 1 },
      { key: 'p25', color: colors.amber, dash: '6,3', opacity: 0.9 },
      { key: 'p75', color: colors.amber, dash: '6,3', opacity: 0.9 },
    ];

    markers.forEach(marker => {
      const value = metric.summary?.[marker.key];
      if (value == null) return;
      g.append('line')
        .attr('x1', x(value))
        .attr('x2', x(value))
        .attr('y1', 0)
        .attr('y2', innerHeight)
        .attr('stroke', marker.color)
        .attr('stroke-width', 2)
        .attr('stroke-dasharray', marker.dash)
        .attr('opacity', marker.opacity);
    });

    if (metric.alpha != null) {
      g.append('line')
        .attr('x1', x(metric.alpha))
        .attr('x2', x(metric.alpha))
        .attr('y1', 0)
        .attr('y2', innerHeight)
        .attr('stroke', colors.red)
        .attr('stroke-width', 2.5)
        .attr('stroke-dasharray', '6,4');
    }

    // Summary caption
    const summaryEntries = [
      { key: 'mean', label: 'Mean' },
      { key: 'median', label: 'Median' },
      { key: 'p25', label: 'P25' },
      { key: 'p75', label: 'P75' },
      { key: 'min', label: 'Min' },
      { key: 'max', label: 'Max' },
      { key: 'alpha', label: 'Alpha' },
    ];
    const titleFormatter = formatterFor(metric.format);
    const summaryText = summaryEntries
      .map(entry => {
        const value = entry.key === 'alpha' ? metric.alpha : metric.summary?.[entry.key];
        if (value == null) return null;
        return `${entry.label}: ${titleFormatter(value)}`;
      })
      .filter(Boolean)
      .join(' · ');

    svg.append('text')
      .attr('class', 'distribution-caption')
      .attr('x', margin.left)
      .attr('y', margin.top - 4)
      .attr('fill', colors.textSecondary)
      .attr('font-size', 11)
      .text(summaryText);
  }
}

// ============================================================================
// Alpha Cashflow Chart (with interactive cursor)
// ============================================================================

function renderAlphaCashflow(dataSource) {
  const svg = d3.select('#alpha-cashflow-chart');
  if (svg.empty()) return;

  const svgNode = svg.node();
  const container = svgNode.parentElement;
  const width = svgNode.clientWidth || container?.clientWidth || 800;
  // Use container height if available (for resizable containers)
  const height = container?.classList.contains('chart-container') 
    ? container.clientHeight 
    : (svgNode.clientHeight || 500);
  svg.selectAll('*').remove();

  if (!width || !height || height < 100) return;

  const alphaData = (dataSource || []).map((entry) => {
    const parsedDate = entry?.date ? parseISODate(entry.date) : null;
    return {
      date: parsedDate,
      inflow: typeof entry?.inflow === 'number' ? entry.inflow : 0,
      outflow: typeof entry?.outflow === 'number' ? entry.outflow : 0,
      inflow_amount: typeof entry?.inflow_amount === 'number' ? entry.inflow_amount : 0,
      outflow_amount: typeof entry?.outflow_amount === 'number' ? entry.outflow_amount : 0,
    };
  }).filter(d => d.date instanceof Date && !Number.isNaN(d.date.valueOf()))
    .sort((a, b) => a.date - b.date);

  const medianSeriesRaw = (jCurveData || []).map(entry => ({
    date: entry?.date ? parseISODate(entry.date) : null,
    value: typeof entry?.median === 'number' ? entry.median : null,
  })).filter(d => d.date instanceof Date && !Number.isNaN(d.date.valueOf()) && Number.isFinite(d.value))
    .sort((a, b) => a.date - b.date);

  const smoothingWindow = medianSeriesRaw.length >= 9 ? 5 : 3;
  const smoothedMedian = smoothSeries(medianSeriesRaw, smoothingWindow);

  if (!alphaData.length && !smoothedMedian.length) {
    const placeholder = svg.append('g').attr('transform', `translate(${width / 2},${height / 2})`);
    placeholder.append('text')
      .attr('text-anchor', 'middle')
      .attr('fill', colors.textMuted)
      .attr('font-size', 14)
      .text('Cashflow data unavailable');
    return;
  }

  const margin = { top: 30, right: 110, bottom: 70, left: 100 };
  const innerWidth = Math.max(1, width - margin.left - margin.right);
  const innerHeight = Math.max(1, height - margin.top - margin.bottom);
  const dateFormatter = d3.timeFormat('%b %Y');
  const tooltipCurrency = formatterFor('currency');

  const domainTimestamps = new Set();
  alphaData.forEach(d => domainTimestamps.add(d.date.getTime()));
  smoothedMedian.forEach(d => domainTimestamps.add(d.date.getTime()));
  const domainDates = Array.from(domainTimestamps)
    .filter(Number.isFinite)
    .sort((a, b) => a - b)
    .map(ms => new Date(ms));

  if (!domainDates.length) {
    const placeholder = svg.append('g').attr('transform', `translate(${width / 2},${height / 2})`);
    placeholder.append('text')
      .attr('text-anchor', 'middle')
      .attr('fill', colors.textMuted)
      .attr('font-size', 14)
      .text('Cashflow timeline unavailable');
    return;
  }

  const minDate = domainDates[0];
  const maxDate = domainDates[domainDates.length - 1];
  let xDomainStart = minDate;
  let xDomainEnd = maxDate;
  if (minDate.getTime() === maxDate.getTime()) {
    xDomainStart = d3.utcMonth.offset(minDate, -1);
    xDomainEnd = d3.utcMonth.offset(maxDate, 1);
  }

  const x = d3.scaleUtc()
    .domain([xDomainStart, xDomainEnd])
    .range([0, innerWidth]);

  let barWidth = Math.min(28, Math.max(6, innerWidth / Math.max(domainDates.length, 6) * 0.6));
  if (domainDates.length > 1) {
    let minDelta = Infinity;
    for (let i = 1; i < domainDates.length; i += 1) {
      const delta = domainDates[i] - domainDates[i - 1];
      if (delta > 0 && delta < minDelta) minDelta = delta;
    }
    if (Number.isFinite(minDelta) && minDelta > 0) {
      const reference = x(new Date(minDate.getTime() + minDelta)) - x(minDate);
      if (Number.isFinite(reference) && reference > 0) {
        barWidth = Math.min(28, Math.max(6, reference * 0.6));
      }
    }
  }

  const barValues = [];
  alphaData.forEach(d => {
    if (Number.isFinite(d.inflow)) barValues.push(d.inflow);
    if (Number.isFinite(d.outflow)) barValues.push(d.outflow);
  });
  if (!barValues.length) barValues.push(0);

  const lineValues = smoothedMedian.map(d => d.value).filter(Number.isFinite);
  if (!lineValues.length) lineValues.push(0);

  const barMin = Math.min(...barValues, 0);
  const barMax = Math.max(...barValues, 0);
  const lineMin = Math.min(...lineValues, 0);
  const lineMax = Math.max(...lineValues, 0);

  const barDomain = expandDomain([Math.min(barMin, 0), Math.max(barMax, 0)], 0.12);
  const lineDomain = expandDomain([Math.min(lineMin, 0), Math.max(lineMax, 0)], 0.12);

  const yBars = d3.scaleLinear()
    .domain(barDomain)
    .nice()
    .range([innerHeight, 0]);

  const yLine = d3.scaleLinear()
    .domain(lineDomain)
    .nice()
    .range([innerHeight, 0]);

  const yBarZero = yBars(0);
  const yLineZero = yLine(0);

  const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

  // Grid lines
  g.append('g')
    .attr('class', 'grid')
    .selectAll('line')
    .data(yLine.ticks(6))
    .join('line')
    .attr('x1', 0)
    .attr('x2', innerWidth)
    .attr('y1', d => yLine(d))
    .attr('y2', d => yLine(d))
    .attr('stroke', colors.grid)
    .attr('stroke-dasharray', '2,4');

  // Outflow bars (negative, red)
  g.selectAll('.bar-outflow')
    .data(alphaData)
    .join('rect')
    .attr('class', 'bar-outflow')
    .attr('x', d => (x(d.date) ?? 0) - barWidth / 2)
    .attr('width', Math.max(2, barWidth))
    .attr('y', d => {
      const scaled = yBars(d.outflow);
      return Math.min(yBarZero, scaled);
    })
    .attr('height', d => {
      const scaled = yBars(d.outflow);
      return Math.max(0, Math.abs(scaled - yBarZero));
    })
    .attr('fill', colors.red)
    .attr('opacity', 0.75)
    .on('mouseenter', (event, d) => {
      if (d.outflow_amount > 0) {
        showTooltip(
          `<div class="tooltip-title">${dateFormatter(d.date)}</div>
           <div class="tooltip-row"><span class="label">Deployments:</span><span class="value">${tooltipCurrency(d.outflow_amount)}</span></div>`,
          event.pageX, event.pageY
        );
      }
    })
    .on('mousemove', positionTooltip)
    .on('mouseleave', hideTooltip);

  // Inflow bars (positive, green)
  g.selectAll('.bar-inflow')
    .data(alphaData)
    .join('rect')
    .attr('class', 'bar-inflow')
    .attr('x', d => (x(d.date) ?? 0) - barWidth / 2)
    .attr('width', Math.max(2, barWidth))
    .attr('y', d => {
      const scaled = yBars(d.inflow);
      return Math.min(yBarZero, scaled);
    })
    .attr('height', d => {
      const scaled = yBars(d.inflow);
      return Math.max(0, Math.abs(scaled - yBarZero));
    })
    .attr('fill', colors.green)
    .attr('opacity', 0.78)
    .on('mouseenter', (event, d) => {
      if (d.inflow_amount > 0) {
        showTooltip(
          `<div class="tooltip-title">${dateFormatter(d.date)}</div>
           <div class="tooltip-row"><span class="label">Payouts:</span><span class="value">${tooltipCurrency(d.inflow_amount)}</span></div>`,
          event.pageX, event.pageY
        );
      }
    })
    .on('mousemove', positionTooltip)
    .on('mouseleave', hideTooltip);

  // Zero line (x-axis at y=0)
  g.append('line')
    .attr('class', 'zero-line')
    .attr('x1', 0)
    .attr('x2', innerWidth)
    .attr('y1', yBarZero)
    .attr('y2', yBarZero)
    .attr('stroke', colors.axis)
    .attr('stroke-width', 1.5)
    .attr('stroke-dasharray', '6,4');

  // Cumulative line
  const cumulativeLine = d3.line()
    .defined(d => Number.isFinite(d.value))
    .x(d => x(d.date))
    .y(d => yLine(d.value))
    .curve(d3.curveMonotoneX);

  g.append('path')
    .datum(smoothedMedian)
    .attr('fill', 'none')
    .attr('stroke', colors.amber)
    .attr('stroke-width', 2.5)
    .attr('d', cumulativeLine);

  // Cumulative points
  g.selectAll('.cumulative-point')
    .data(smoothedMedian.filter(d => Number.isFinite(d.value)))
    .join('circle')
    .attr('class', 'cumulative-point')
    .attr('cx', d => x(d.date))
    .attr('cy', d => yLine(d.value))
    .attr('r', 3)
    .attr('fill', colors.amber)
    .attr('stroke', '#0a0f1a')
    .attr('stroke-width', 1)
    .on('mouseenter', (event, d) => {
      showTooltip(
        `<div class="tooltip-title">${dateFormatter(d.date)}</div>
         <div class="tooltip-row"><span class="label">Median cumulative:</span><span class="value">${tooltipCurrency(d.value)}</span></div>`,
        event.pageX, event.pageY
      );
    })
    .on('mousemove', positionTooltip)
    .on('mouseleave', hideTooltip);

  // Axes
  const xAxis = d3.axisBottom(x)
    .ticks(8)
    .tickFormat(d3.timeFormat('%b %Y'));

  const yAxisLeft = d3.axisLeft(yLine)
    .ticks(6)
    .tickFormat(axisFormatterFor('currency'));

  const yAxisRight = d3.axisRight(yBars)
    .ticks(6)
    .tickFormat(axisFormatterFor('currency'));

  // X-axis at y=0 position
  const xAxisGroup = g.append('g')
    .attr('transform', `translate(0,${innerHeight})`)
    .call(xAxis);

  xAxisGroup.selectAll('text')
    .attr('text-anchor', 'end')
    .attr('transform', 'rotate(-35)')
    .attr('dx', '-0.5em')
    .attr('dy', '0.3em')
    .attr('fill', colors.textSecondary);

  g.append('g')
    .call(yAxisLeft)
    .selectAll('text')
    .attr('fill', colors.textSecondary);

  g.append('g')
    .attr('transform', `translate(${innerWidth},0)`)
    .call(yAxisRight)
    .selectAll('text')
    .attr('fill', colors.textSecondary);

  // Axis labels
  svg.append('text')
    .attr('class', 'axis-label')
    .attr('transform', `translate(${margin.left - 70},${margin.top + innerHeight / 2}) rotate(-90)`)
    .attr('text-anchor', 'middle')
    .attr('fill', colors.textMuted)
    .attr('font-size', 11)
    .text('Median net (INR Cr)');

  svg.append('text')
    .attr('class', 'axis-label')
    .attr('transform', `translate(${margin.left + innerWidth + 70},${margin.top + innerHeight / 2}) rotate(-90)`)
    .attr('text-anchor', 'middle')
    .attr('fill', colors.textMuted)
    .attr('font-size', 11)
    .text('Monthly cash flow (INR Cr)');

  svg.append('text')
    .attr('x', margin.left + innerWidth / 2)
    .attr('y', height - 10)
    .attr('text-anchor', 'middle')
    .attr('fill', colors.textMuted)
    .attr('font-size', 11)
    .text('Month (Alpha scenario)');

  // Add line-following cursor for cumulative net line
  addLineFollowingCursor(svg, g, {
    data: smoothedMedian,
    xAccessor: d => d.date,
    yAccessor: d => d.value,
    x,
    y: yLine,
    innerWidth,
    innerHeight,
    formatX: dateFormatter,
    formatY: axisFormatterFor('currency'),
    lineColor: colors.amber,
  });
}

// ============================================================================
// J-Curve Chart (with interactive cursor)
// ============================================================================

function renderJCurve() {
  const svg = d3.select('#j-curve-chart');
  const svgNode = svg.node();
  const container = svgNode.parentElement;
  const width = svgNode.clientWidth || container?.clientWidth || 800;
  const height = container?.classList.contains('chart-container') 
    ? container.clientHeight 
    : (svgNode.clientHeight || 450);
  svg.selectAll('*').remove();

  if (!width || !height || height < 100) return;

  const margin = { top: 25, right: 50, bottom: 60, left: 80 };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;

  const data = jCurveData.map(d => ({
    date: parseISODate(d.date),
    p5: d.p5,
    p25: d.p25,
    median: d.median,
    p75: d.p75,
    p95: d.p95,
  }));

  const x = d3.scaleTime()
    .domain(d3.extent(data, d => d.date))
    .range([0, innerWidth]);

  const yDomain = [
    d3.min(data, d => Math.min(d.p5 ?? 0, d.median ?? 0)),
    d3.max(data, d => Math.max(d.p95 ?? 0, d.median ?? 0))
  ];

  const y = d3.scaleLinear()
    .domain(expandDomain(yDomain, 0.08))
    .nice()
    .range([innerHeight, 0]);

  const yZero = y(0);

  const area95 = d3.area()
    .x(d => x(d.date))
    .y0(d => y(d.p5))
    .y1(d => y(d.p95))
    .curve(d3.curveMonotoneX);

  const area50 = d3.area()
    .x(d => x(d.date))
    .y0(d => y(d.p25))
    .y1(d => y(d.p75))
    .curve(d3.curveMonotoneX);

  const lineMedian = d3.line()
    .x(d => x(d.date))
    .y(d => y(d.median))
    .curve(d3.curveMonotoneX);

  const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

  // Grid lines
  g.append('g')
    .attr('class', 'grid')
    .selectAll('line')
    .data(y.ticks(6))
    .join('line')
    .attr('x1', 0)
    .attr('x2', innerWidth)
    .attr('y1', d => y(d))
    .attr('y2', d => y(d))
    .attr('stroke', colors.grid)
    .attr('stroke-dasharray', '2,4');

  // Areas and lines
  g.append('path')
    .datum(data)
    .attr('fill', colors.dark)
    .attr('opacity', 0.35)
    .attr('d', area95);

  g.append('path')
    .datum(data)
    .attr('fill', colors.secondary)
    .attr('opacity', 0.45)
    .attr('d', area50);

  g.append('path')
    .datum(data)
    .attr('fill', 'none')
    .attr('stroke', colors.amber)
    .attr('stroke-width', 2.5)
    .attr('d', lineMedian);

  // Zero line
  if (yZero >= 0 && yZero <= innerHeight) {
    g.append('line')
      .attr('class', 'zero-line')
      .attr('x1', 0)
      .attr('x2', innerWidth)
      .attr('y1', yZero)
      .attr('y2', yZero)
      .attr('stroke', colors.axis)
      .attr('stroke-width', 1.5)
      .attr('stroke-dasharray', '6,4');
  }

  // Axes
  const xAxis = d3.axisBottom(x).ticks(8).tickFormat(d3.timeFormat('%b %Y'));
  const yAxis = d3.axisLeft(y).ticks(6).tickFormat(axisFormatterFor('currency'));

  const xAxisGroup = g.append('g')
    .attr('transform', `translate(0,${innerHeight})`)
    .attr('class', 'x-axis')
    .call(xAxis);

  xAxisGroup.selectAll('text')
    .attr('text-anchor', 'end')
    .attr('transform', 'rotate(-35)')
    .attr('dx', '-0.5em')
    .attr('dy', '0.3em')
    .attr('fill', colors.textSecondary);

  g.append('g')
    .attr('class', 'y-axis')
    .call(yAxis)
    .selectAll('text')
    .attr('fill', colors.textSecondary);

  // Axis labels
  svg.append('text')
    .attr('class', 'axis-label')
    .attr('transform', `translate(${margin.left - 55},${margin.top + innerHeight / 2}) rotate(-90)`)
    .attr('text-anchor', 'middle')
    .attr('fill', colors.textMuted)
    .attr('font-size', 11)
    .text('Cumulative Cash Flow (INR Cr)');

  svg.append('text')
    .attr('x', margin.left + innerWidth / 2)
    .attr('y', height - 8)
    .attr('text-anchor', 'middle')
    .attr('fill', colors.textMuted)
    .attr('font-size', 11)
    .text('Month');

  // Add line-following cursor for median line
  const dateFormatter = d3.timeFormat('%b %Y');
  addLineFollowingCursor(svg, g, {
    data: data.filter(d => d.median != null),
    xAccessor: d => d.date,
    yAccessor: d => d.median,
    x,
    y,
    innerWidth,
    innerHeight,
    formatX: dateFormatter,
    formatY: axisFormatterFor('currency'),
    lineColor: colors.amber,
  });
}

// ============================================================================
// IRR Histogram (with interactive cursor)
// ============================================================================

function renderIRRHistogram() {
  const svg = d3.select('#irr-histogram');
  const svgNode = svg.node();
  const container = svgNode.parentElement;
  const width = svgNode.clientWidth || container?.clientWidth || 800;
  const height = container?.classList.contains('chart-container') 
    ? container.clientHeight 
    : (svgNode.clientHeight || 380);
  svg.selectAll('*').remove();

  if (!width || !height || height < 100) return;

  const margin = { top: 25, right: 40, bottom: 55, left: 70 };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;

  const irrPercent = irrData.map(d => d * 100);
  const x = d3.scaleLinear()
    .domain(expandDomain(d3.extent(irrPercent)))
    .nice()
    .range([0, innerWidth]);

  const bins = d3.bin().domain(x.domain()).thresholds(25)(irrPercent);

  const y = d3.scaleLinear()
    .domain([0, d3.max(bins, d => d.length) || 1])
    .range([innerHeight, 0]);

  const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

  // Grid lines
  g.append('g')
    .attr('class', 'grid')
    .selectAll('line')
    .data(y.ticks(5))
    .join('line')
    .attr('x1', 0)
    .attr('x2', innerWidth)
    .attr('y1', d => y(d))
    .attr('y2', d => y(d))
    .attr('stroke', colors.grid)
    .attr('stroke-dasharray', '2,4');

  // Histogram bars with hover
  g.selectAll('rect')
    .data(bins)
    .join('rect')
    .attr('x', d => x(d.x0))
    .attr('y', d => y(d.length))
    .attr('width', d => Math.max(0, x(d.x1) - x(d.x0) - 1))
    .attr('height', d => innerHeight - y(d.length))
    .attr('fill', colors.primary)
    .attr('opacity', 0.75)
    .on('mouseenter', (event, d) => {
      showTooltip(
        `<div class="tooltip-title">IRR Range</div>
         <div class="tooltip-row"><span class="label">Range:</span><span class="value">${d.x0.toFixed(1)}% - ${d.x1.toFixed(1)}%</span></div>
         <div class="tooltip-row"><span class="label">Count:</span><span class="value">${d.length} simulations</span></div>`,
        event.pageX, event.pageY
      );
    })
    .on('mousemove', positionTooltip)
    .on('mouseleave', hideTooltip);

  // Axes
  const xAxis = d3.axisBottom(x).ticks(8).tickFormat(d => `${d.toFixed(0)}%`);
  const yAxis = d3.axisLeft(y).ticks(5);

  g.append('g')
    .attr('transform', `translate(0,${innerHeight})`)
    .call(xAxis)
    .selectAll('text')
    .attr('fill', colors.textSecondary);

  g.append('g')
    .call(yAxis)
    .selectAll('text')
    .attr('fill', colors.textSecondary);

  // Axis labels
  svg.append('text')
    .attr('class', 'axis-label')
    .attr('x', margin.left + innerWidth / 2)
    .attr('y', height - 10)
    .attr('text-anchor', 'middle')
    .attr('fill', colors.textMuted)
    .attr('font-size', 11)
    .text('Net Annualised IRR (%)');

  svg.append('text')
    .attr('class', 'axis-label')
    .attr('transform', `translate(${margin.left - 50},${margin.top + innerHeight / 2}) rotate(-90)`)
    .attr('text-anchor', 'middle')
    .attr('fill', colors.textMuted)
    .attr('font-size', 11)
    .text('Frequency');

  // Add cursor tracker
  addCursorTracker(svg, g, x, y, innerWidth, innerHeight,
    d => `${d.toFixed(1)}%`,
    d => d.toFixed(0)
  );
}

// ============================================================================
// NAV Comparison Chart (with interactive cursor)
// ============================================================================

function renderNavComparison() {
  const svg = d3.select('#nav-comparison');
  if (svg.empty()) return;

  const svgNode = svg.node();
  const container = svgNode.parentElement;
  const width = svgNode.clientWidth || container?.clientWidth || 800;
  const height = container?.classList.contains('chart-container') 
    ? container.clientHeight 
    : (svgNode.clientHeight || 400);
  svg.selectAll('*').remove();

  if (!width || !height || height < 100) return;

  if (!navData.length) {
    const placeholder = svg.append('g').attr('transform', `translate(${width / 2},${height / 2})`);
    placeholder.append('text')
      .attr('text-anchor', 'middle')
      .attr('fill', colors.textMuted)
      .attr('font-size', 14)
      .text('NAV data unavailable');
    return;
  }

  const margin = { top: 30, right: 60, bottom: 55, left: 75 };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;

  const parseDate = d3.timeParse('%Y-%m-%d');
  const data = navData.map(d => ({
    date: parseDate(d.date),
    market_nav: d.market_nav,
    total_nav: d.total_nav,
    hybrid_nav: d.hybrid_nav,
  })).filter(d => d.date instanceof Date && !isNaN(d.date));

  if (!data.length) return;

  const x = d3.scaleTime()
    .domain(d3.extent(data, d => d.date))
    .range([0, innerWidth]);

  const values = [];
  data.forEach(d => {
    if (d.market_nav != null) values.push(d.market_nav);
    if (d.total_nav != null) values.push(d.total_nav);
    if (d.hybrid_nav != null) values.push(d.hybrid_nav);
  });

  if (!values.length) return;

  const yDomain = expandDomain(d3.extent(values), 0.08);
  const y = d3.scaleLinear()
    .domain(yDomain)
    .nice()
    .range([innerHeight, 0]);

  const lineColors = {
    market_nav: colors.primary,
    total_nav: colors.teal,
    hybrid_nav: colors.amber,
  };

  const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

  // Grid lines
  g.append('g')
    .attr('class', 'grid')
    .selectAll('line')
    .data(y.ticks(6))
    .join('line')
    .attr('x1', 0)
    .attr('x2', innerWidth)
    .attr('y1', d => y(d))
    .attr('y2', d => y(d))
    .attr('stroke', colors.grid)
    .attr('stroke-dasharray', '2,4');

  const lineGenerator = (key) => d3.line()
    .defined(d => d[key] != null)
    .x(d => x(d.date))
    .y(d => y(d[key]))
    .curve(d3.curveMonotoneX);

  ['market_nav', 'total_nav', 'hybrid_nav'].forEach(key => {
    g.append('path')
      .datum(data)
      .attr('fill', 'none')
      .attr('stroke', lineColors[key])
      .attr('stroke-width', 2.25)
      .attr('d', lineGenerator(key));
  });

  // Axes
  const xAxis = d3.axisBottom(x).ticks(8).tickFormat(d3.timeFormat('%b %Y'));
  const yAxis = d3.axisLeft(y).ticks(6).tickFormat(d => `${d.toFixed(1)} Cr`);

  const xAxisGroup = g.append('g')
    .attr('transform', `translate(0,${innerHeight})`)
    .call(xAxis);

  xAxisGroup.selectAll('text')
    .attr('text-anchor', 'end')
    .attr('transform', 'rotate(-35)')
    .attr('dx', '-0.5em')
    .attr('dy', '0.3em')
    .attr('fill', colors.textSecondary);

  g.append('g')
    .call(yAxis)
    .selectAll('text')
    .attr('fill', colors.textSecondary);

  // Axis label
  svg.append('text')
    .attr('class', 'axis-label')
    .attr('transform', `translate(${margin.left - 55},${margin.top + innerHeight / 2}) rotate(-90)`)
    .attr('text-anchor', 'middle')
    .attr('fill', colors.textMuted)
    .attr('font-size', 11)
    .text('NAV (INR Cr, rebased to 10 Cr)');

  // Add cursor tracker
  const dateFormatter = d3.timeFormat('%b %Y');
  addCursorTracker(svg, g, x, y, innerWidth, innerHeight,
    dateFormatter,
    d => `${d.toFixed(2)} Cr`
  );
}

// ============================================================================
// Sensitivity Charts (with interactive cursor)
// ============================================================================

function renderSensitivity() {
  const wrapper = d3.select('#sensitivity-wrapper');
  wrapper.selectAll('*').remove();

  if (!sensitivityData.length) {
    wrapper.append('p')
      .style('color', colors.textMuted)
      .text('No sensitivity files detected. Run sensitivity.py to populate this section.');
    return;
  }

  sensitivityData.forEach(series => {
    const container = wrapper.append('div').attr('class', 'panel').style('margin-bottom', '1.5rem');
    container.append('h3')
      .style('color', colors.secondary)
      .style('font-size', '1rem')
      .style('margin', '0 0 0.75rem')
      .text(series.variable.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()));

    const svg = container.append('svg').attr('height', 360);
    const width = svg.node().clientWidth;
    const height = svg.node().clientHeight;

    const margin = { top: 30, right: 80, bottom: 55, left: 75 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;

    const values = series.records.map(d => d.value);
    const irrValues = series.records.map(d => d.net_annualised_irr_pct);
    const roicValues = series.records.map(d => d.roic_multiple);

    const x = d3.scaleLinear()
      .domain(expandDomain(d3.extent(values)))
      .range([0, innerWidth]);

    const yLeft = d3.scaleLinear()
      .domain(expandDomain(d3.extent(irrValues)))
      .nice()
      .range([innerHeight, 0]);

    const yRight = d3.scaleLinear()
      .domain(expandDomain(d3.extent(roicValues)))
      .nice()
      .range([innerHeight, 0]);

    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    // Grid lines
    g.append('g')
      .attr('class', 'grid')
      .selectAll('line')
      .data(yLeft.ticks(5))
      .join('line')
      .attr('x1', 0)
      .attr('x2', innerWidth)
      .attr('y1', d => yLeft(d))
      .attr('y2', d => yLeft(d))
      .attr('stroke', colors.grid)
      .attr('stroke-dasharray', '2,4');

    const lineIRR = d3.line()
      .x((d, i) => x(values[i]))
      .y((d, i) => yLeft(irrValues[i]))
      .curve(d3.curveMonotoneX);

    const lineROIC = d3.line()
      .x((d, i) => x(values[i]))
      .y((d, i) => yRight(roicValues[i]))
      .curve(d3.curveMonotoneX);

    g.append('path')
      .datum(series.records)
      .attr('fill', 'none')
      .attr('stroke', colors.teal)
      .attr('stroke-width', 2)
      .attr('d', lineIRR);

    g.append('path')
      .datum(series.records)
      .attr('fill', 'none')
      .attr('stroke', colors.amber)
      .attr('stroke-width', 2)
      .attr('d', lineROIC);

    // Axes
    const xAxis = d3.axisBottom(x).ticks(6);
    const yAxisLeft = d3.axisLeft(yLeft).ticks(5).tickFormat(d => `${d.toFixed(1)}%`);
    const yAxisRight = d3.axisRight(yRight).ticks(5).tickFormat(d => `${d.toFixed(2)}x`);

    g.append('g')
      .attr('transform', `translate(0,${innerHeight})`)
      .call(xAxis)
      .selectAll('text')
      .attr('fill', colors.textSecondary);

    g.append('g')
      .call(yAxisLeft)
      .selectAll('text')
      .attr('fill', colors.textSecondary);

    g.append('g')
      .attr('transform', `translate(${innerWidth},0)`)
      .call(yAxisRight)
      .selectAll('text')
      .attr('fill', colors.textSecondary);

    // Axis labels
    svg.append('text')
      .attr('class', 'axis-label')
      .attr('transform', `translate(${margin.left - 55},${margin.top + innerHeight / 2}) rotate(-90)`)
      .attr('text-anchor', 'middle')
      .attr('fill', colors.textMuted)
      .attr('font-size', 10)
      .text('IRR (%)');

    svg.append('text')
      .attr('class', 'axis-label')
      .attr('transform', `translate(${margin.left + innerWidth + 55},${margin.top + innerHeight / 2}) rotate(-90)`)
      .attr('text-anchor', 'middle')
      .attr('fill', colors.textMuted)
      .attr('font-size', 10)
      .text('ROIC (x)');

    // Legend
    const legend = container.append('div').attr('class', 'legend').style('margin-top', '0.5rem');
    legend.append('span').html(`<span class="swatch" style="background:${colors.teal}"></span>Net Annualised IRR (%)`);
    legend.append('span').html(`<span class="swatch" style="background:${colors.amber}"></span>ROIC Multiple`);
  });
}

// ============================================================================
// Initialization
// ============================================================================

// Render all charts
function renderAllCharts() {
  renderGroupedTable('#metadata-table', metadataData, metadataGroups);
  renderGroupedTable('#metrics-table', metricsData, metricGroups);
  renderSimulationSummaryTable(simulationStatsData);
  renderDistributionExplorer(simulationDistributionsData);
  renderAlphaCashflow(alphaCashflowData);
  renderJCurve();
  renderIRRHistogram();
  renderNavComparison();
  renderSensitivity();
}

// Initial render
renderAllCharts();
renderKPICards();
initCollapsibleSections();

// Handle window resize
window.addEventListener('resize', () => {
  renderAlphaCashflow(alphaCashflowData);
  renderJCurve();
  renderIRRHistogram();
  renderNavComparison();
  renderDistributionExplorer(simulationDistributionsData);
  renderSensitivity();
});

// ========================================
// KPI Cards Rendering
// ========================================
function renderKPICards() {
  // metricsData is an array of {key, value} objects
  const metrics = metricsData || [];
  
  // Helper to find metric value by key pattern (case-insensitive partial match)
  const findMetric = (patterns) => {
    for (const pattern of patterns) {
      const item = metrics.find(m => 
        m.key && m.key.toLowerCase().includes(pattern.toLowerCase())
      );
      if (item) return item.value;
    }
    return null;
  };
  
  // Format helpers - extract number from formatted strings
  const extractNumber = (val) => {
    if (val === null || val === undefined) return NaN;
    if (typeof val === 'number') return val;
    // Extract first number from string (handles "51.57%", "3.67x", "INR 497.80 cr", etc.)
    const match = val.match(/-?[\d.]+/);
    return match ? parseFloat(match[0]) : NaN;
  };
  
  const formatPercent = (val) => {
    if (val === null || val === undefined) return '—';
    // If already formatted as percent, just return it cleaned up
    if (typeof val === 'string' && val.includes('%')) {
      const num = extractNumber(val);
      if (!isNaN(num)) return num.toFixed(1) + '%';
    }
    const num = extractNumber(val);
    if (isNaN(num)) return '—';
    return num.toFixed(1) + '%';
  };
  
  const formatMultiple = (val) => {
    if (val === null || val === undefined) return '—';
    // If already formatted as multiple, just return it cleaned up
    if (typeof val === 'string' && val.includes('x')) {
      const num = extractNumber(val);
      if (!isNaN(num)) return num.toFixed(2) + 'x';
    }
    const num = extractNumber(val);
    if (isNaN(num)) return '—';
    return num.toFixed(2) + 'x';
  };
  
  const formatCurrency = (val) => {
    if (val === null || val === undefined) return '—';
    // Extract INR value from strings like "INR 497.80 cr / USD 56,567,743.21"
    if (typeof val === 'string') {
      const inrMatch = val.match(/INR\s*([\d,.]+)\s*cr/i);
      if (inrMatch) {
        const num = parseFloat(inrMatch[1].replace(/,/g, ''));
        return '₹' + num.toFixed(1) + ' Cr';
      }
    }
    const num = extractNumber(val);
    if (isNaN(num)) return '—';
    return '₹' + num.toFixed(1) + ' Cr';
  };
  
  const formatDuration = (val) => {
    if (val === null || val === undefined) return '—';
    // Extract months from "80 months"
    const match = typeof val === 'string' ? val.match(/(\d+)\s*months?/i) : null;
    if (match) return match[1] + ' mo';
    const num = extractNumber(val);
    if (isNaN(num)) return '—';
    return Math.round(num) + ' mo';
  };
  
  // KPI mappings with search patterns matching actual data keys
  const kpiMappings = {
    'kpi-net-irr': { 
      patterns: ['Net Annualised IRR', 'Net Monthly IRR', 'Net IRR'], 
      format: formatPercent, 
      positive: true 
    },
    'kpi-tvpi': { 
      patterns: ['ROIC Multiple', 'TVPI', 'Total Value'], 
      format: formatMultiple, 
      positive: true 
    },
    'kpi-dpi': { 
      patterns: ['Gross ROIC Multiple', 'DPI'], 
      format: formatMultiple 
    },
    'kpi-rvpi': { 
      patterns: ['Hybrid CAGR', 'RVPI'], 
      format: formatPercent 
    },
    'kpi-capital-called': { 
      patterns: ['Total Outflows', 'Capital Called', 'Deployment'], 
      format: formatCurrency 
    },
    'kpi-current-nav': { 
      patterns: ['Total Inflows', 'Gross Investment Returns', 'NAV'], 
      format: formatCurrency 
    }
  };
  
  for (const [elementId, config] of Object.entries(kpiMappings)) {
    const element = document.getElementById(elementId);
    if (!element) continue;
    
    const rawValue = findMetric(config.patterns);
    
    if (rawValue !== null) {
      const formatted = config.format(rawValue);
      element.textContent = formatted;
      
      // Add positive/negative class based on value
      const num = extractNumber(rawValue);
      if (!isNaN(num) && config.positive !== undefined) {
        element.classList.remove('positive', 'negative');
        if (num > 0) element.classList.add('positive');
        else if (num < 0) element.classList.add('negative');
      }
    }
  }
}

// ========================================
// Collapsible Sections
// ========================================
function initCollapsibleSections() {
  const STORAGE_KEY = 'dashboard_collapsed_sections';
  
  // Load collapsed state from localStorage
  let collapsedSections = {};
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      collapsedSections = JSON.parse(stored);
    }
  } catch (e) {
    console.warn('Could not load collapsed sections state:', e);
  }
  
  // Apply saved collapsed states
  document.querySelectorAll('.panel.collapsible').forEach(panel => {
    const sectionId = panel.dataset.section;
    if (sectionId && collapsedSections[sectionId]) {
      panel.classList.add('collapsed');
    }
  });
  
  // Save collapsed state to localStorage
  const saveCollapsedState = () => {
    const state = {};
    document.querySelectorAll('.panel.collapsible').forEach(panel => {
      const sectionId = panel.dataset.section;
      if (sectionId) {
        state[sectionId] = panel.classList.contains('collapsed');
      }
    });
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      console.warn('Could not save collapsed sections state:', e);
    }
  };
  
  // Add click handlers
  document.querySelectorAll('.panel.collapsible h2').forEach(header => {
    header.addEventListener('click', (e) => {
      // Don't toggle if clicking on controls inside header
      if (e.target.closest('select, input, button:not(.collapse-toggle)')) return;
      
      const panel = header.closest('.panel');
      const wasCollapsed = panel.classList.contains('collapsed');
      panel.classList.toggle('collapsed');
      
      // If expanding, trigger resize to redraw charts
      if (wasCollapsed) {
        const chartContainer = panel.querySelector('.chart-container');
        if (chartContainer) {
          // Small delay to allow DOM update
          setTimeout(() => {
            const svg = chartContainer.querySelector('svg');
            if (svg) {
              // Trigger resize observer by dispatching a synthetic resize
              window.dispatchEvent(new Event('resize'));
            }
          }, 50);
        }
      }
      
      saveCollapsedState();
    });
  });
  
  // Prevent collapse toggle button from double-triggering
  document.querySelectorAll('.collapse-toggle').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const header = btn.closest('h2');
      if (header) header.click();
    });
  });
}

// Handle container resize (for vertical resizing)
const resizeObserver = new ResizeObserver((entries) => {
  for (const entry of entries) {
    const container = entry.target;
    const svg = container.querySelector('svg');
    if (!svg) continue;
    
    const id = svg.id;
    // Debounce redraws during active resizing
    clearTimeout(container._resizeTimeout);
    container._resizeTimeout = setTimeout(() => {
      switch (id) {
        case 'j-curve-chart':
          renderJCurve();
          break;
        case 'alpha-cashflow-chart':
          renderAlphaCashflow(alphaCashflowData);
          break;
        case 'irr-histogram':
          renderIRRHistogram();
          break;
        case 'nav-comparison':
          renderNavComparison();
          break;
        case 'distribution-chart':
          renderDistributionExplorer(simulationDistributionsData);
          break;
      }
    }, 100);
  }
});

// Observe all chart containers
document.querySelectorAll('.chart-container').forEach(container => {
  resizeObserver.observe(container);
});
