// Tourism Arrivals Explorer (D3 v7)
// Expects a long-format CSV at data/tourism_arrivals_long_sample.csv with columns:
// country,iso3,region,year,arrivals
// Interactive visualization with dynamic queries, brushing, zooming, and animation

const DATA_URL = "data/tourism_arrivals_long_sample.csv";

const margin = { top: 28, right: 120, bottom: 42, left: 80 };
let width, height, innerW, innerH;

const svg = d3.select("#chart");
const defs = svg.append("defs");
const clipPath = defs.append("clipPath").attr("id", "clip");
const clipRect = clipPath.append("rect");

const g = svg.append("g");
const gx = g.append("g").attr("class", "axis axis--x");
const gy = g.append("g").attr("class", "axis axis--y");
const gridX = g.append("g").attr("class", "grid grid--x");
const gridY = g.append("g").attr("class", "grid grid--y");
const linesG = g.append("g").attr("class", "lines").attr("clip-path", "url(#clip)");
const labelsG = g.append("g").attr("class", "line-labels");
const legendG = svg.append("g").attr("class", "legend");
const xLabel = svg.append("text").attr("text-anchor", "middle").attr("dy", "-6");
const yLabel = svg.append("text").attr("text-anchor", "middle").attr("transform", "rotate(-90)");
const tooltip = d3.select("#tooltip");

// Zoom behavior
const zoom = d3.zoom()
    .scaleExtent([0.5, 10])
    .on("zoom", zoomed);

const regionSelect = document.getElementById("regionSelect");
const countrySelect = document.getElementById("countrySelect");
const measureSelect = document.getElementById("measureSelect");
const yearMin = document.getElementById("yearMin");
const yearMax = document.getElementById("yearMax");
const yearOut = document.getElementById("yearOut");
const playBtn = document.getElementById("playBtn");
const resetBtn = document.getElementById("resetBtn");
const stats = document.getElementById("stats");

const x = d3.scaleLinear();
const y = d3.scaleLinear();
const colorByRegion = d3.scaleOrdinal(d3.schemeTableau10);
const colorByCountry = d3.scaleOrdinal(d3.schemeCategory10);
let color = colorByRegion; // Default to coloring by region

let raw = [];
let byCountry = [];
let regions = [];
let countries = [];
let timer = null;
let currentTransform = d3.zoomIdentity;
let focusedCountry = null;

function resize() {
  const rect = svg.node().getBoundingClientRect();
  width = rect.width; height = rect.height;
  innerW = width - margin.left - margin.right;
  innerH = height - margin.top - margin.bottom;

  g.attr("transform", `translate(${margin.left},${margin.top})`);
  clipRect.attr("width", innerW).attr("height", innerH);

  x.range([0, innerW]); y.range([innerH, 0]);

  // Position x-axis
  gx.attr("transform", `translate(0,${innerH})`);
  gridX.attr("transform", `translate(0,${innerH})`);

  xLabel.attr("x", width / 2).attr("y", height - 8).text("Year");
  updateYAxisLabel();

  // Position legend
  legendG.attr("transform", `translate(${width - margin.right + 10}, ${margin.top})`);

  // Enable zoom on SVG
  svg.call(zoom).on("dblclick.zoom", resetZoom);

  // Click background to clear focus
  svg.on("click", () => {
    if (focusedCountry) {
      toggleFocus(focusedCountry);
    }
  });

  render();
}
window.addEventListener("resize", resize);

d3.csv(DATA_URL, d3.autoType).then(csv => {
  raw = csv;
  // domain for y
  y.domain([0, d3.max(raw, d => d.arrivals) * 1.05]);

  // lists
  regions = Array.from(new Set(raw.map(d => d.region))).filter(d => d && d !== "Aggregates").sort();
  countries = Array.from(new Set(raw.map(d => d.country))).sort();

  regionSelect.innerHTML = `<option value="All">All regions</option>` + regions.map(r => `<option>${r}</option>`).join("");
  countrySelect.innerHTML = `<option value="All">All countries</option>` + countries.map(c => `<option>${c}</option>`).join("");

  // group by country
  byCountry = d3.groups(raw, d => d.country).map(([k, values]) => ({ country: k, values: values.sort((a,b)=>d3.ascending(a.year,b.year)), region: values[0].region }));

  // events
  regionSelect.addEventListener("change", render);
  countrySelect.addEventListener("change", render);
  measureSelect.addEventListener("change", () => { updateYAxisLabel(); render(true); });
  yearMin.addEventListener("input", syncYears);
  yearMax.addEventListener("input", syncYears);
  playBtn.addEventListener("click", togglePlay);
  resetBtn.addEventListener("click", reset);

  syncYears();
  resize();
});

function syncYears(){
  let min = +yearMin.value, max = +yearMax.value;
  if (min > max){ const tmp = min; min = max; max = tmp; yearMin.value = min; yearMax.value = max; }
  yearOut.textContent = `${min}–${max}`;
  render(true);
}

function updateYAxisLabel() {
  const measure = measureSelect.value;
  let label;

  switch(measure) {
    case "growth":
      label = "Year-over-Year Growth (%)";
      break;
    case "growthRate":
      label = "Growth Rate (% of 1995 baseline)";
      break;
    case "perCapita":
      label = "Normalized Arrivals (% of peak)";
      break;
    case "absolute":
    default:
      label = "International Tourist Arrivals";
      break;
  }

  yLabel.attr("x", -(height / 2)).attr("y", 16).text(label);
}

function getFiltered(){
  const r = regionSelect.value;
  const c = countrySelect.value;
  const min = +yearMin.value, max = +yearMax.value;

  let subset = byCountry.filter(d => (r==="All" || d.region===r) && (c==="All" || d.country===c))
    .map(d => ({ ...d, values: d.values.filter(v => v.year>=min && v.year<=max) }))
    .filter(d => d.values.length > 0);

  // If showing all regions and all countries, aggregate by region
  if (r === "All" && c === "All") {
    // Group countries by region and sum arrivals
    const byRegion = d3.group(subset, d => d.region);
    subset = Array.from(byRegion, ([region, countries]) => {
      // Get all unique years
      const allYears = new Set();
      countries.forEach(country => {
        country.values.forEach(v => allYears.add(v.year));
      });

      // For each year, sum arrivals across all countries in the region
      const values = Array.from(allYears).sort((a, b) => a - b).map(year => {
        const totalArrivals = countries.reduce((sum, country) => {
          const yearData = country.values.find(v => v.year === year);
          return sum + (yearData ? yearData.arrivals : 0);
        }, 0);
        return { year, arrivals: totalArrivals };
      });

      return {
        country: region, // Use region name as the identifier
        region: region,
        values: values
      };
    });
  }

  return subset;
}

function applyMeasure(data) {
  const measure = measureSelect.value;

  return data.map(d => {
    let transformedValues;

    switch(measure) {
      case "growth":
        // Year-over-year growth percentage
        transformedValues = d.values.map((v, i) => {
          if (i === 0) {
            return { year: v.year, arrivals: 0 }; // First year has no prior year
          }
          const prevArrivals = d.values[i - 1].arrivals;
          const growthPercent = prevArrivals > 0 ? ((v.arrivals - prevArrivals) / prevArrivals) * 100 : 0;
          return { year: v.year, arrivals: growthPercent };
        });
        break;

      case "growthRate":
        // Growth rate relative to first year (1995 baseline)
        const baselineArrivals = d.values[0]?.arrivals || 1;
        transformedValues = d.values.map(v => ({
          year: v.year,
          arrivals: baselineArrivals > 0 ? ((v.arrivals / baselineArrivals) * 100) : 100
        }));
        break;

      case "perCapita":
        // Normalize by dividing by maximum value (scaled 0-100)
        const maxArrivals = d3.max(d.values, v => v.arrivals) || 1;
        transformedValues = d.values.map(v => ({
          year: v.year,
          arrivals: (v.arrivals / maxArrivals) * 100
        }));
        break;

      case "absolute":
      default:
        // Raw arrivals data
        transformedValues = d.values;
        break;
    }

    return {
      ...d,
      values: transformedValues
    };
  });
}

function render(withTransition=false){
  let data = getFiltered();

  // Apply measure transformation
  data = applyMeasure(data);

  // Determine if we should color by country or region
  const selectedRegion = regionSelect.value;
  const selectedCountry = countrySelect.value;
  const colorByWhat = (selectedRegion !== "All" || selectedCountry !== "All") ? "country" : "region";

  if (colorByWhat === "country") {
    color = colorByCountry;
    color.domain(data.map(d => d.country));
  } else {
    color = colorByRegion;
    color.domain(Array.from(new Set(data.map(d => d.region))));
  }

  // Update x domain based on selected year range
  const min = +yearMin.value, max = +yearMax.value;
  x.domain([min, max]);

  // Update y domain based on filtered period and measure
  const measure = measureSelect.value;
  const allValues = data.flatMap(d => d.values.map(v => v.arrivals));
  let minY = measure === "growth" ? d3.min(allValues) : 0;
  let maxY = d3.max(allValues) || 1;

  // Add padding
  const padding = (maxY - minY) * 0.05;
  y.domain([minY - padding, maxY + padding]);

  // Update axes with appropriate formatting
  gx.call(d3.axisBottom(x).tickFormat(d3.format("d")).ticks(Math.min(10, max - min + 1)));

  // Format y-axis based on measure
  let yAxisFormat;
  if (measure === "growth" || measure === "perCapita" || measure === "growthRate") {
    yAxisFormat = d => d3.format(".1f")(d) + "%";
  } else {
    yAxisFormat = d => d3.format(",")(d);
  }
  gy.call(d3.axisLeft(y).ticks(Math.max(4, innerH/80)).tickFormat(yAxisFormat));

  // Update grids
  gridX.call(d3.axisBottom(x).tickSize(-innerH).tickFormat("").ticks(Math.min(10, max - min + 1)))
    .call(g => g.select(".domain").remove())
    .call(g => g.selectAll(".tick line").attr("stroke", "#eee").attr("stroke-opacity", 0.7));

  gridY.call(d3.axisLeft(y).tickSize(-innerW).tickFormat("").ticks(Math.max(4, innerH/80)))
    .call(g => g.select(".domain").remove())
    .call(g => g.selectAll(".tick line").attr("stroke", "#eee").attr("stroke-opacity", 0.7));

  const line = d3.line()
    .x(d => x(d.year))
    .y(d => y(d.arrivals))
    .curve(d3.curveMonotoneX);

  const sel = linesG.selectAll(".series").data(data, d => d.country);

  // Exit
  sel.exit()
    .transition()
    .duration(withTransition ? 300 : 0)
    .style("opacity", 0)
    .remove();

  const t = svg.transition().duration(withTransition ? 500 : 0);

  // Update
  sel.select("path")
    .transition(t)
    .attr("d", d => line(d.values))
    .attr("stroke", d => colorByWhat === "country" ? color(d.country) : color(d.region));

  // Enter
  const enter = sel.enter().append("g").attr("class","series")
    .style("opacity", 0)
    .on("mousemove", (event, d) => showTip(event, d))
    .on("mouseleave", hideTip)
    .on("click", (event, d) => { event.stopPropagation(); toggleFocus(d.country); });

  enter.append("path")
    .attr("class","line")
    .attr("fill","none")
    .attr("stroke", d => colorByWhat === "country" ? color(d.country) : color(d.region))
    .attr("stroke-width", 2)
    .attr("d", d => line(d.values));

  enter.append("title").text(d => d.country);

  // Fade in new series
  enter.transition()
    .duration(withTransition ? 300 : 0)
    .style("opacity", 1);

  // Update legend
  updateLegend(data);

  // Update stats
  updateStats(data);
}

function showTip(event, d){
  const min = +yearMin.value, max = +yearMax.value;
  const first = d.values.find(v => v.year===min);
  const last = d.values.find(v => v.year===max);
  const change = (first && last) ? ((last.arrivals - first.arrivals) / first.arrivals * 100) : null;
  const changeClass = change > 0 ? 'positive' : change < 0 ? 'negative' : 'neutral';

  // Get the color based on current color scheme
  const selectedRegion = regionSelect.value;
  const lineColor = (selectedRegion !== "All") ? color(d.country) : color(d.region);

  tooltip.html(`<strong style="color: ${lineColor}">${d.country}</strong><br/>
  Region: <strong>${d.region}</strong><br/>
  Period: ${min}–${max}<br/>
  ${min}: <strong>${first ? d3.format(",")(first.arrivals) : "–"}</strong><br/>
  ${max}: <strong>${last ? d3.format(",")(last.arrivals) : "–"}</strong><br/>
  ${change!==null ? `Change: <strong class="${changeClass}">${change > 0 ? '+' : ''}${change.toFixed(1)}%</strong>` : ""}`);

  const { pageX, pageY } = event;
  tooltip.style("left", (pageX + 12) + "px").style("top", (pageY + 12) + "px").attr("hidden", null);

  // Highlight hovered line
  d3.select(event.currentTarget).select("path")
    .attr("stroke-width", 3.5)
    .style("filter", "drop-shadow(0 0 4px rgba(0,0,0,0.3))");
}

function hideTip(){
  tooltip.attr("hidden", true);

  // Reset line width unless focused
  linesG.selectAll(".series:not(.focused) path")
    .attr("stroke-width", 2)
    .style("filter", null);
}

function toggleFocus(country){
  if (focusedCountry === country) {
    // Unfocus
    focusedCountry = null;
    linesG.selectAll(".series")
      .classed("focused", false)
      .style("opacity", 1)
      .select("path")
      .attr("stroke-width", 2)
      .style("filter", null);
  } else {
    // Focus on this country
    focusedCountry = country;
    linesG.selectAll(".series")
      .classed("focused", d => d.country === country)
      .style("opacity", d => d.country === country ? 1 : 0.15)
      .select("path")
      .attr("stroke-width", d => d.country === country ? 4 : 2)
      .style("filter", d => d.country === country ? "drop-shadow(0 0 6px rgba(0,0,0,0.4))" : null);
  }
}

function togglePlay(){
  const pressed = playBtn.getAttribute("aria-pressed")==="true";
  if (pressed){ stopPlay(); return; }
  playBtn.setAttribute("aria-pressed","true");
  playBtn.textContent = "Pause";
  const startYear = +yearMin.value;
  let endYear = +yearMax.value;

  timer = d3.interval(() => {
    // Increment end year
    endYear++;

    // Check if we've reached the end
    if (endYear > 2020) {
      // Reset to start year + 1
      endYear = startYear + 1;
    }

    yearMin.value = startYear;
    yearMax.value = endYear;
    syncYears();
  }, 600);
}

function stopPlay(){
  playBtn.setAttribute("aria-pressed","false");
  playBtn.textContent = "Play";
  if (timer){ timer.stop(); timer = null; }
}

function zoomed(event) {
  currentTransform = event.transform;
  const newX = currentTransform.rescaleX(x);

  const min = +yearMin.value, max = +yearMax.value;
  gx.call(d3.axisBottom(newX).tickFormat(d3.format("d")).ticks(Math.min(10, max - min + 1)));
  gridX.call(d3.axisBottom(newX).tickSize(-innerH).tickFormat("").ticks(Math.min(10, max - min + 1)))
    .call(g => g.select(".domain").remove())
    .call(g => g.selectAll(".tick line").attr("stroke", "#eee").attr("stroke-opacity", 0.7));

  linesG.selectAll(".series path").attr("d", d => {
    return d3.line()
      .x(v => newX(v.year))
      .y(v => y(v.arrivals))
      .curve(d3.curveMonotoneX)(d.values);
  });
}

function resetZoom() {
  svg.transition()
    .duration(750)
    .call(zoom.transform, d3.zoomIdentity);
}

function reset(){
  regionSelect.value = "All";
  countrySelect.value = "All";
  yearMin.value = 1995; yearMax.value = 2020;
  focusedCountry = null;
  stopPlay();
  resetZoom();
  syncYears();
}

function updateLegend(data) {
  const selectedRegion = regionSelect.value;
  const selectedCountry = countrySelect.value;

  // Determine what to show in legend
  let legendData, legendKey, legendLabel;
  if (selectedCountry !== "All") {
    // Show the specific country when a country is selected
    legendData = data.map(d => d.country);
    legendKey = d => d;
    legendLabel = d => d;
  } else if (selectedRegion !== "All") {
    // Show countries when a region is selected
    legendData = data.map(d => d.country).sort();
    legendKey = d => d;
    legendLabel = d => d;
  } else {
    // Show regions when "All" is selected
    legendData = Array.from(new Set(data.map(d => d.region))).sort();
    legendKey = d => d;
    legendLabel = d => d;
  }

  const items = legendG.selectAll(".legend-item")
    .data(legendData, legendKey);

  items.exit().remove();

  const enter = items.enter()
    .append("g")
    .attr("class", "legend-item")
    .attr("transform", (d, i) => `translate(0, ${i * 20})`)
    .style("cursor", selectedRegion === "All" ? "pointer" : "default");

  // Only add click handler for regions (not countries)
  if (selectedRegion === "All") {
    enter.on("click", (event, region) => {
      regionSelect.value = region;
      regionSelect.dispatchEvent(new Event('change'));
    });
  }

  enter.append("rect")
    .attr("width", 12)
    .attr("height", 12);

  enter.append("text")
    .attr("x", 18)
    .attr("y", 10)
    .attr("font-size", "12px");

  // Update all items (enter + existing)
  const allItems = items.merge(enter);

  allItems.attr("transform", (d, i) => `translate(0, ${i * 20})`);

  allItems.select("rect")
    .attr("fill", d => {
      if (selectedRegion !== "All") {
        // Color by country
        return color(d);
      } else {
        // Color by region
        return color(d);
      }
    });

  allItems.select("text")
    .text(legendLabel);
}

function updateStats(data){
  const min = +yearMin.value, max = +yearMax.value;

  // If same year selected, show top countries by absolute arrivals
  if (min === max) {
    const topCountries = data
      .map(d => {
        const val = d.values.find(v => v.year === min);
        return { country: d.country, region: d.region, arrivals: val ? val.arrivals : 0 };
      })
      .filter(d => d.arrivals > 0)
      .sort((a, b) => d3.descending(a.arrivals, b.arrivals))
      .slice(0, 5);
    const items = topCountries.map(d => `<li>${d.country} — ${d3.format(",")(d.arrivals)}</li>`).join("");
    stats.innerHTML = `<strong>Top destinations (${min}):</strong><ol>${items || "<li>n/a</li>"}</ol>`;
  } else {
    // compute top growth countries in range
    const growth = data.map(d => {
      const first = d.values.find(v => v.year === min);
      const last = d.values.find(v => v.year === max);
      const g = (first && last && first.arrivals > 0) ? ((last.arrivals - first.arrivals) / first.arrivals) : null;
      return { country: d.country, region: d.region, growth: g, first: first, last: last };
    }).filter(d => d.growth !== null && !isNaN(d.growth)).sort((a, b) => d3.descending(a.growth, b.growth)).slice(0, 5);
    const items = growth.map(d => `<li>${d.country} — ${d.growth > 0 ? '+' : ''}${(d.growth * 100).toFixed(1)}%</li>`).join("");
    stats.innerHTML = `<strong>Top growth (${min}–${max}):</strong><ol>${items || "<li>n/a</li>"}</ol>`;
  }
}
