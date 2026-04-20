/**
 * script.js — PathFinder (Real World / Leaflet + Overpass UI)
 * =====================================
 * Implements a real city-map visualization using OpenStreetMap data.
 * Features BFS, DFS, Dijkstra, A*, Greedy Best-First, and Bidirectional BFS.
 */

'use strict';

/* ============================================================
   SECTION 1: CONSTANTS & CONFIGURATION
   ============================================================ */

const SPEED_MAP = {
  1: 150, // Very slow
  2: 80,  // Slow
  3: 30,  // Medium
  4: 5,   // Fast
  5: 1    // Very fast
};

const SPEED_LABELS = {
  1: 'Very Slow', 2: 'Slow', 3: 'Medium', 4: 'Fast', 5: 'Blazing'
};

const ALGO_INFO = {
  bfs: { name: 'Breadth-First Search', desc: 'Explores equally in all directions. Unweighted.' },
  dfs: { name: 'Depth-First Search', desc: 'Wanders deeply until a dead end. Extremely inefficient.' },
  dijkstra: { name: "Dijkstra's Algorithm", desc: 'Always chooses the closest intersection by actual street distance. Optimal.' },
  astar: { name: 'A* Algorithm', desc: 'Uses spatial intuition toward the drop-off to explore efficiently. Optimal.' },
  greedy: { name: 'Greedy Best-First', desc: 'Focuses strictly on geometric proximity to the goal. Very fast, not always optimal.' },
  bibfs: { name: 'Bidirectional BFS', desc: 'Searches simultaneously from both ends to meet in the middle.' }
};

/* ============================================================
   SECTION 2: GLOBAL STATE & LEAFLET
   ============================================================ */
let map; // Leaflet map object
let canvasRenderer; // Leaflet canvas renderer for high performance
let baseRoadsLayer = L.featureGroup();
let exploreLayer = L.featureGroup();
let pathLayer = L.featureGroup();
let markersLayer = L.featureGroup();

let nodesMap = new Map(); // OSM Node ID -> Node Data
let nodesArray = [];      // Array of nodes for easy iteration
let edgesArray = [];      // Array of all road segments {n1, n2, distance}

let startNode = null;
let endNode = null;
let placingPhase = 'idle'; // 'pickup', 'drop', 'idle'
let isRunning = false;
let selectedAlgo = 'bfs';
let currentSpeed = 3;
let allResults = {};

let startMarker = null;
let endMarker = null;
let currentLocationLatLng = null;
let pendingManualLocations = {
  pickup: null,
  drop: null
};

// The Rider Marker
let riderMarker = null;

/* ============================================================
   SECTION 3: DOM REFERENCES
   ============================================================ */
const btnLoadRoads = document.getElementById('btnLoadRoads');
const overpassStatus = document.getElementById('overpassStatus');
const routeCard = document.getElementById('routeCard');

const btnFindRoute = document.getElementById('btnFindRoute');
const btnRunAll = document.getElementById('btnRunAll');
const btnReset = document.getElementById('btnReset');
const speedSlider = document.getElementById('speedSlider');
const speedLabel = document.getElementById('speedLabel');

const pickupDisplay = document.getElementById('pickupDisplay');
const dropDisplay = document.getElementById('dropDisplay');
const pickupText = document.getElementById('pickupText');
const dropText = document.getElementById('dropText');
const pickupManualInput = document.getElementById('pickupManualInput');
const dropManualInput = document.getElementById('dropManualInput');
const btnSetPickup = document.getElementById('btnSetPickup');
const btnSetDrop = document.getElementById('btnSetDrop');

const modeBadge = document.getElementById('modeBadge');
const modeText = document.getElementById('modeText');

const summaryCard = document.getElementById('summaryCard');
const summaryAlgo = document.getElementById('summaryAlgo');
const summaryBadge = document.getElementById('summaryBadge');
const sTime = document.getElementById('sTime');
const sNodes = document.getElementById('sNodes');
const sPath = document.getElementById('sPath');

const compareCard = document.getElementById('compareCard');
const compBody = document.getElementById('compBody');

const algoPillsContainer = document.getElementById('algoPills');
const algoBlurb = document.getElementById('algoBlurb');
const blurbName = document.getElementById('blurbName');
const blurbText = document.getElementById('blurbText');

const mapProgress = document.getElementById('mapProgress');
const mapProgressFill = document.getElementById('mapProgressFill');
const runningChip = document.getElementById('runningChip');
const chipText = document.getElementById('chipText');
const toast = document.getElementById('toast');
const headerCity = document.getElementById('headerCity');

const DEFAULT_MAP_CENTER = [28.6304, 77.2177];
const DEFAULT_MAP_ZOOM = 15;

/* ============================================================
   SECTION 4: INITIALIZATION
   ============================================================ */

function init() {
  initLeaflet();
  updateAlgoInfo('bfs');
  setupEventListeners();
}

function initLeaflet() {
  // Start with a usable fallback, then move to the user's browser location.
  map = L.map('map', { zoomControl: false }).setView(DEFAULT_MAP_CENTER, DEFAULT_MAP_ZOOM);
  
  L.control.zoom({ position: 'bottomright' }).addTo(map);

  // CartoDB Positron base map (clean Google map style)
  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
    subdomains: 'abcd',
    maxZoom: 19
  }).addTo(map);

  canvasRenderer = L.canvas({ padding: 0.5 });
  baseRoadsLayer.addTo(map);
  exploreLayer.addTo(map);
  pathLayer.addTo(map);
  markersLayer.addTo(map);

  map.on('moveend', () => {
    updateHeaderLocation();
  });
  
  // Custom click handler on map
  map.on('click', handleMapClick);

  updateHeaderLocation();
  centerMapOnCurrentLocation();
}

function updateHeaderLocation() {
  const center = map.getCenter();
  headerCity.textContent = `Lat: ${center.lat.toFixed(4)}, Lng: ${center.lng.toFixed(4)}`;
}

function centerMapOnCurrentLocation() {
  if (!navigator.geolocation) {
    showToast('Current location is not supported by this browser.');
    return;
  }

  headerCity.textContent = 'Getting current location...';
  navigator.geolocation.getCurrentPosition(
    (position) => {
      const { latitude, longitude } = position.coords;
      currentLocationLatLng = L.latLng(latitude, longitude);
      map.setView(currentLocationLatLng, DEFAULT_MAP_ZOOM);
      updateHeaderLocation();
      suggestPickupFromCurrentLocation();
      showToast('Map centered on your current location.');
    },
    () => {
      updateHeaderLocation();
      showToast('Location permission denied. Using default map area.');
    },
    {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 60000
    }
  );
}

function setupEventListeners() {
  btnLoadRoads.addEventListener('click', fetchOverpassData);

  pickupDisplay.addEventListener('click', () => {
    if(!routeCard.classList.contains('disabled')) setMode('pickup');
  });
  dropDisplay.addEventListener('click', () => {
    if(!routeCard.classList.contains('disabled')) setMode('drop');
  });

  btnFindRoute.addEventListener('click', startSimulation);
  btnReset.addEventListener('click', resetApp);
  btnRunAll.addEventListener('click', runAllAlgorithms);
  btnSetPickup.addEventListener('click', () => applyManualLocation('pickup'));
  btnSetDrop.addEventListener('click', () => applyManualLocation('drop'));
  pickupManualInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') applyManualLocation('pickup');
  });
  dropManualInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') applyManualLocation('drop');
  });

  algoPillsContainer.addEventListener('click', (e) => {
    if (e.target.classList.contains('algo-pill')) {
      document.querySelectorAll('.algo-pill').forEach(p => p.classList.remove('active'));
      e.target.classList.add('active');
      selectedAlgo = e.target.dataset.algo;
      updateAlgoInfo(selectedAlgo);
      summaryCard.classList.add('hidden');
    }
  });

  speedSlider.addEventListener('input', (e) => {
    currentSpeed = parseInt(e.target.value);
    speedLabel.textContent = SPEED_LABELS[currentSpeed];
    const pct = ((currentSpeed - 1) / 4) * 100;
    speedSlider.style.background = `linear-gradient(to right, var(--orange) ${pct}%, #e5e7eb ${pct}%)`;
  });
}

function setMode(mode) {
  placingPhase = mode;
  updateUIState();
}

function updateUIState() {
  if (startNode) {
    pickupDisplay.classList.add('set');
    pickupText.textContent = `Node: ${startNode.id}`;
  } else {
    pickupDisplay.classList.remove('set');
    pickupText.textContent = 'Click on street to set pickup';
  }

  if (endNode) {
    dropDisplay.classList.add('set');
    dropText.textContent = `Node: ${endNode.id}`;
  } else {
    dropDisplay.classList.remove('set');
    dropText.textContent = 'Click on street to set drop';
  }

  pickupDisplay.style.borderColor = placingPhase === 'pickup' ? 'var(--green)' : '';
  dropDisplay.style.borderColor = placingPhase === 'drop' ? 'var(--orange)' : '';

  if (placingPhase === 'pickup') {
    modeBadge.style.display = 'flex';
    modeBadge.style.color = 'var(--green)';
    modeBadge.style.background = 'var(--green-light)';
    modeBadge.style.borderColor = 'rgba(16,185,129,0.3)';
    modeBadge.querySelector('.mode-dot').style.background = 'var(--green)';
    modeText.textContent = 'Click map to place Pickup 🟢';
  } else if (placingPhase === 'drop') {
    modeBadge.style.display = 'flex';
    modeBadge.style.color = 'var(--orange-dark)';
    modeBadge.style.background = '#fff8f5';
    modeBadge.style.borderColor = '#ffd4c2';
    modeBadge.querySelector('.mode-dot').style.background = 'var(--orange)';
    modeText.textContent = 'Click map to place Drop 📍';
  } else {
    modeBadge.style.display = 'none';
  }

  const ready = startNode !== null && endNode !== null;
  btnFindRoute.disabled = !ready;
  btnRunAll.disabled = !ready;
}

function updateAlgoInfo(algo) {
  const info = ALGO_INFO[algo] || {name: algo, desc: ''};
  blurbName.textContent = info.name;
  blurbText.textContent = info.desc;
}

/* ============================================================
   SECTION 5: OVERPASS API INTEGRATION
   ============================================================ */

async function fetchOverpassData() {
  if (isRunning) return;
  
  const bounds = map.getBounds();
  const S = bounds.getSouth();
  const W = bounds.getWest();
  const N = bounds.getNorth();
  const E = bounds.getEast();

  // Prevent loading massive areas
  if (N - S > 0.15 || E - W > 0.15) {
    showToast("Area too large! Please zoom in slightly closer.");
    return;
  }

  btnLoadRoads.disabled = true;
  overpassStatus.textContent = "Querying OpenStreetMap...";
  mapProgress.classList.add('visible');
  mapProgressFill.style.width = '100%';
  runningChip.classList.remove('hidden');
  chipText.textContent = "Extracting roads...";

  // Overpass QL to get highways
  const query = `
    [out:json][timeout:60];
    (
      way["highway"~"primary|secondary|tertiary|residential|unclassified|living_street"](${S},${W},${N},${E});
    );
    out body;
    >;
    out skel qt;
  `;

  try {
    const response = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      body: query
    });

    if (!response.ok) throw new Error("Overpass API failed");

    const data = await response.json();
    processOSMData(data);
    
    overpassStatus.textContent = `${nodesArray.length} intersections loaded.`;
    routeCard.classList.remove('disabled');
    btnLoadRoads.textContent = "Refresh Street Network";
    applyPendingManualLocations();
    suggestPickupFromCurrentLocation();
    setMode(startNode && endNode ? 'idle' : (startNode ? 'drop' : 'pickup'));

  } catch (error) {
    console.error(error);
    showToast("Failed to load map data. Try again later.");
    overpassStatus.textContent = "Error loading data.";
  } finally {
    btnLoadRoads.disabled = false;
    mapProgress.classList.remove('visible');
    runningChip.classList.add('hidden');
  }
}

function processOSMData(data) {
  // Clear previous
  nodesMap.clear();
  nodesArray = [];
  edgesArray = [];
  baseRoadsLayer.clearLayers();
  exploreLayer.clearLayers();
  pathLayer.clearLayers();
  markersLayer.clearLayers();
  if (riderMarker) map.removeLayer(riderMarker);
  
  startNode = null;
  endNode = null;
  startMarker = null;
  endMarker = null;

  // 1. Process all nodes
  data.elements.forEach(el => {
    if (el.type === 'node') {
      const nodeObj = {
        id: el.id,
        lat: el.lat,
        lng: el.lon,
        edges: [],
        
        // Algo props
        visited: false,
        isExploring: false,
        isExploringSecondary: false,
        distance: Infinity,
        gCost: Infinity,
        hCost: 0,
        fCost: Infinity,
        previous: null,
        visitedBy: null
      };
      nodesMap.set(el.id, nodeObj);
    }
  });

  // 2. Process all ways (edges)
  data.elements.forEach(el => {
    if (el.type === 'way' && el.nodes) {
      for (let i = 0; i < el.nodes.length - 1; i++) {
        const n1 = nodesMap.get(el.nodes[i]);
        const n2 = nodesMap.get(el.nodes[i+1]);
        
        if (n1 && n2) {
          const latlng1 = L.latLng(n1.lat, n1.lng);
          const latlng2 = L.latLng(n2.lat, n2.lng);
          const dist = latlng1.distanceTo(latlng2); // Actual meters
          
          n1.edges.push({ node: n2, cost: dist });
          n2.edges.push({ node: n1, cost: dist }); // Undirected
          
          edgesArray.push({ n1, n2 });
        }
      }
    }
  });

  // Filter out disconnected nodes
  nodesArray = Array.from(nodesMap.values()).filter(n => n.edges.length > 0);

  drawBaseExtractedRoads();
}

function drawBaseExtractedRoads() {
  const lines = [];
  edgesArray.forEach(edge => {
    lines.push([[edge.n1.lat, edge.n1.lng], [edge.n2.lat, edge.n2.lng]]);
  });

  // One big multi-polyline for performance
  L.polyline(lines, {
    color: '#a0aab2', 
    weight: 4, 
    opacity: 0.6,
    renderer: canvasRenderer,
    interactive: false
  }).addTo(baseRoadsLayer);
}

/* ============================================================
   SECTION 6: INTERACTION & PINS
   ============================================================ */

function handleMapClick(e) {
  if (isRunning || nodesArray.length === 0 || placingPhase === 'idle') return;

  placeRouteNode(placingPhase, e.latlng);
}

function findNearestNode(latLng) {
  let nearest = null;
  let minDist = Infinity;
  nodesArray.forEach(n => {
    const d = latLng.distanceTo(L.latLng(n.lat, n.lng));
    if (d < minDist) {
      minDist = d;
      nearest = n;
    }
  });

  return { nearest, minDist };
}

function placeRouteNode(type, latLng, label = '') {
  if (isRunning || nodesArray.length === 0) return false;

  const { nearest, minDist } = findNearestNode(latLng);
  if (!nearest || minDist > 400) {
    showToast(label ? "Location is outside the loaded street network." : "Click directly on a grey street!");
    return false;
  }

  if (type === 'pickup') {
    startNode = nearest;
    updatePin('pickup');
    if (label) pickupManualInput.value = label;
    setMode('drop');
  } else if (type === 'drop') {
    if (nearest === startNode) {
      showToast('Drop must be different from pickup.');
      return false;
    }
    endNode = nearest;
    updatePin('drop');
    if (label) dropManualInput.value = label;
    setMode(startNode ? 'idle' : 'pickup');
  }

  clearVisualization();
  updateUIState();
  return true;
}

function suggestPickupFromCurrentLocation() {
  if (!currentLocationLatLng || startNode || pendingManualLocations.pickup || nodesArray.length === 0) return;

  const wasPlaced = placeRouteNode('pickup', currentLocationLatLng, 'Current location');
  if (wasPlaced) {
    showToast('Pickup suggested from your current location.');
  }
}

async function applyManualLocation(type) {
  if (isRunning) return;

  const input = type === 'pickup' ? pickupManualInput : dropManualInput;
  const value = input.value.trim();
  if (!value) {
    showToast(`Enter a ${type} address or coordinates.`);
    return;
  }

  const latLng = await resolveLocationInput(value);
  if (!latLng) {
    showToast('Location not found. Try a clearer address or lat,lng.');
    return;
  }

  if (nodesArray.length === 0) {
    pendingManualLocations[type] = { latLng, label: value };
    map.setView(latLng, DEFAULT_MAP_ZOOM);
    showToast('Map moved there. Extract the street network, then set the point.');
    return;
  }

  const placed = placeRouteNode(type, latLng, value);
  if (placed) {
    map.panTo(latLng);
    showToast(`${type === 'pickup' ? 'Pickup' : 'Drop'} set from manual location.`);
  }
}

async function resolveLocationInput(value) {
  const coordinateMatch = value.match(/^\s*(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)\s*$/);
  if (coordinateMatch) {
    const lat = Number(coordinateMatch[1]);
    const lng = Number(coordinateMatch[2]);
    if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
      return L.latLng(lat, lng);
    }
  }

  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(value)}`;
  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/json' }
    });
    if (!response.ok) return null;

    const results = await response.json();
    if (!Array.isArray(results) || results.length === 0) return null;

    return L.latLng(Number(results[0].lat), Number(results[0].lon));
  } catch (error) {
    console.error(error);
    return null;
  }
}

function applyPendingManualLocations() {
  ['pickup', 'drop'].forEach((type) => {
    const pending = pendingManualLocations[type];
    if (!pending) return;

    const placed = placeRouteNode(type, pending.latLng, pending.label);
    if (placed) pendingManualLocations[type] = null;
  });
}

function updatePin(type) {
  const isPickup = type === 'pickup';
  const node = isPickup ? startNode : endNode;
  
  const iconHtml = isPickup ? 
    `<div style="background-color:#10b981; width:16px; height:16px; border-radius:50%; border:3px solid white; box-shadow:0 2px 5px rgba(0,0,0,0.3);"></div>` :
    `<svg width="24" height="24" viewBox="0 0 24 24" fill="#FF6B35" style="transform:translate(-50%,-100%);"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z" stroke="white" stroke-width="2"/><circle cx="12" cy="9" r="3" fill="white"/></svg>`;
  
  const icon = L.divIcon({
    html: iconHtml,
    className: 'custom-leaflet-pin',
    iconSize: isPickup ? [16, 16] : [0, 0],
    iconAnchor: isPickup ? [8, 8] : [0, 0]
  });

  if (isPickup) {
    if (startMarker) map.removeLayer(startMarker);
    startMarker = L.marker([node.lat, node.lng], { icon }).addTo(markersLayer);
  } else {
    if (endMarker) map.removeLayer(endMarker);
    endMarker = L.marker([node.lat, node.lng], { icon }).addTo(markersLayer);
  }
}

/* ============================================================
   SECTION 7: SIMULATION ENGINE (LEAFLET DYNAMIC RENDERING)
   ============================================================ */

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

async function startSimulation() {
  if (isRunning || !startNode || !endNode) return;
  
  isRunning = true;
  btnFindRoute.disabled = true;
  btnRunAll.disabled = true;
  btnReset.disabled = true;
  document.querySelectorAll('.algo-pill').forEach(p => p.disabled = true);
  
  clearVisualization();
  summaryCard.classList.add('hidden');
  compareCard.classList.add('hidden');
  
  mapProgress.classList.add('visible');
  mapProgressFill.style.width = '0%';
  runningChip.classList.remove('hidden');
  chipText.textContent = `Finding route via ${ALGO_INFO[selectedAlgo].name}...`;

  const speed = SPEED_MAP[currentSpeed];
  
  // Execute Search Math in JS
  const t0 = performance.now();
  let result;
  if (selectedAlgo === 'bfs') result = runBFS(startNode, endNode);
  else if (selectedAlgo === 'dfs') result = runDFS(startNode, endNode);
  else if (selectedAlgo === 'dijkstra') result = runDijkstra(startNode, endNode);
  else if (selectedAlgo === 'astar') result = runAStar(startNode, endNode);
  else if (selectedAlgo === 'greedy') result = runGreedy(startNode, endNode);
  else if (selectedAlgo === 'bibfs') result = runBiBFS(startNode, endNode);
  const t1 = performance.now();
  const timeTaken = (t1 - t0).toFixed(2);

  const { visitedInOrder, path } = result;
  
  allResults[selectedAlgo] = {
    time: timeTaken,
    nodes: visitedInOrder.length,
    path: path.length
  };

  // Phase 1: Animate Explore
  let batchLines = [];
  let batchSecondaryLines = [];
  
  for (let i = 0; i < visitedInOrder.length; i++) {
    if (!isRunning) break;

    const navEvent = visitedInOrder[i];
    const currNode = navEvent.node;
    if (!currNode.previous && !currNode.previousEnd) continue; // Skip start node line

    const prevNode = navEvent.secondary ? currNode.previousEnd : currNode.previous;
    if (prevNode) {
       const line = [[prevNode.lat, prevNode.lng], [currNode.lat, currNode.lng]];
       if (navEvent.secondary) batchSecondaryLines.push(line);
       else batchLines.push(line);
    }

    // Render batch to UI
    const batchSize = Math.max(1, 10 - currentSpeed * 2);
    if (i % batchSize === 0 || i === visitedInOrder.length - 1) {
       
       if (batchLines.length > 0) {
         L.polyline(batchLines, {
           color: 'rgba(245, 158, 11, 0.7)', // Amber
           weight: 4, renderer: canvasRenderer, interactive: false
         }).addTo(exploreLayer);
         batchLines = [];
       }

       if (batchSecondaryLines.length > 0) {
         L.polyline(batchSecondaryLines, {
           color: 'rgba(217, 70, 239, 0.7)', // Fuchsia specific to BiBFS
           weight: 4, renderer: canvasRenderer, interactive: false
         }).addTo(exploreLayer);
         batchSecondaryLines = [];
       }
       
       await delay(speed);
    }
    mapProgressFill.style.width = `${((i+1)/visitedInOrder.length)*100}%`;
  }

  // Phase 2: Animate Final Path
  if (path.length > 0 && isRunning) {
    chipText.textContent = `Route Found! Dispatching rider...`;
    
    // Draw cyan path line by line
    let pathDistance = 0;
    for (let i = 0; i < path.length - 1; i++) {
        if (!isRunning) break;
        const p1 = path[i];
        const p2 = path[i+1];
        
        pathDistance += L.latLng(p1.lat, p1.lng).distanceTo(L.latLng(p2.lat, p2.lng));

        L.polyline([[p1.lat, p1.lng], [p2.lat, p2.lng]], {
            color: '#06b6d4', weight: 6, renderer: canvasRenderer, interactive: false
        }).addTo(pathLayer);

        if (currentSpeed < 5) await delay(speed);
    }

    // Add rider point animating along the line 
    // In Leaflet, smooth animation is complex; a simple jump between nodes is robust.
    await animateRiderMarker(path, speed);

    showSummary(true, timeTaken, visitedInOrder.length, pathDistance);
  } else if (isRunning) {
    showSummary(false, timeTaken, visitedInOrder.length, 0);
  }

  finishSimulation();
}

async function animateRiderMarker(path, speed) {
  if (riderMarker) map.removeLayer(riderMarker);
  
  const riderIcon = L.divIcon({
      html: `<div style="background-color:#1c1c1e; width:12px; height:12px; border-radius:50%; border:2px solid white; box-shadow:0 0 10px rgba(0,0,0,0.5);"></div>`,
      className: 'rider-marker', iconSize: [12,12], iconAnchor: [6,6]
  });

  riderMarker = L.marker([path[0].lat, path[0].lng], {icon: riderIcon, zIndexOffset: 1000}).addTo(map);

  for(let i=1; i<path.length; i++) {
      if(!isRunning) break;
      riderMarker.setLatLng([path[i].lat, path[i].lng]);
      await delay(Math.max(10, speed/2));
  }
}

async function runAllAlgorithms() {
    if (isRunning || !startNode || !endNode) return;
    
    btnRunAll.disabled = true;
    clearVisualization();
    allResults = {};
    
    const algos = ['bfs', 'dfs', 'dijkstra', 'astar', 'greedy', 'bibfs'];
    
    for (const algo of algos) {
        resetNodeStates();
        
        const t0 = performance.now();
        let res;
        if(algo === 'bfs') res = runBFS(startNode, endNode);
        else if (algo === 'dfs') res = runDFS(startNode, endNode);
        else if (algo === 'dijkstra') res = runDijkstra(startNode, endNode);
        else if (algo === 'astar') res = runAStar(startNode, endNode);
        else if (algo === 'greedy') res = runGreedy(startNode, endNode);
        else if (algo === 'bibfs') res = runBiBFS(startNode, endNode);
        const t1 = performance.now();
        
        // calc dist
        let d = 0;
        for(let i=0; i<res.path.length-1; i++) {
           d += L.latLng(res.path[i].lat, res.path[i].lng).distanceTo(L.latLng(res.path[i+1].lat, res.path[i+1].lng));
        }

        allResults[algo] = {
            time: (t1 - t0).toFixed(2),
            nodes: res.visitedInOrder.length,
            path: res.path.length > 0 ? d : 0
        };
    }
    
    startSimulation(); 
    buildCompareTable();
    compareCard.classList.remove('hidden');
}

function clearVisualization() {
  resetNodeStates();
  exploreLayer.clearLayers();
  pathLayer.clearLayers();
  if (riderMarker) map.removeLayer(riderMarker);
}

function resetNodeStates() {
  nodesArray.forEach(node => {
      node.visited = false;
      node.distance = Infinity;
      node.gCost = Infinity;
      node.hCost = 0;
      node.fCost = Infinity;
      node.previous = null;
      node.visitedBy = null;
      node.previousEnd = null;
  });
}

function resetApp() {
  isRunning = false;
  btnFindRoute.disabled = true;
  btnRunAll.disabled = true;
  startNode = null;
  endNode = null;
  placingPhase = 'pickup';
  allResults = {};
  pendingManualLocations = { pickup: null, drop: null };
  
  if(startMarker) map.removeLayer(startMarker);
  if(endMarker) map.removeLayer(endMarker);
  startMarker = null;
  endMarker = null;
  pickupManualInput.value = currentLocationLatLng ? 'Current location' : '';
  dropManualInput.value = '';
  
  summaryCard.classList.add('hidden');
  compareCard.classList.add('hidden');
  mapProgress.classList.remove('visible');
  runningChip.classList.add('hidden');
  
  clearVisualization();
  updateUIState();
  showToast('Reset map. Please pin new locations.');
}

function finishSimulation() {
  isRunning = false;
  btnFindRoute.disabled = false;
  btnRunAll.disabled = false;
  btnReset.disabled = false;
  document.querySelectorAll('.algo-pill').forEach(p => p.disabled = false);
  mapProgress.classList.remove('visible');
  runningChip.classList.add('hidden');
}

function showSummary(found, time, nodesExplored, pathLen) {
  summaryCard.classList.remove('hidden');
  summaryAlgo.textContent = ALGO_INFO[selectedAlgo].name;
  
  if (found) {
    summaryBadge.className = 'summary-badge found';
    summaryBadge.textContent = 'Route Found ✓';
  } else {
    summaryBadge.className = 'summary-badge no-route';
    summaryBadge.textContent = 'No Route ✗';
  }
  
  sTime.textContent = time;
  sNodes.textContent = nodesExplored;
  sPath.textContent = found ? pathLen.toFixed(0) : '—';
}

function buildCompareTable() {
    const keys = Object.keys(allResults);
    let winner = null;
    let minCost = Infinity;
    for(const k of keys) {
        if(allResults[k].path > 0 && allResults[k].path < minCost) {
            minCost = allResults[k].path;
            winner = k;
        }
    }
    const names = {bfs: 'BFS', dfs: 'DFS', dijkstra: 'Dijk.', astar: 'A*', greedy: 'Greedy', bibfs: 'Bi-BFS'};
    
    compBody.innerHTML = keys.map(k => {
        const r = allResults[k];
        const cls = k === winner ? 'winner' : (r.path === 0 ? 'no-path-row' : '');
        return `<tr class="${cls}">
            <td>${names[k]}</td>
            <td>${r.time} ms</td>
            <td>${r.nodes}</td>
            <td>${r.path > 0 ? r.path.toFixed(0) : '—'}</td>
        </tr>`;
    }).join('');
}

function showToast(msg) {
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 3000);
}

function getGeoCost(n1, n2) {
  return L.latLng(n1.lat, n1.lng).distanceTo(L.latLng(n2.lat, n2.lng));
}

function constructPath(endN) {
  let path = [];
  let curr = endN;
  while (curr !== null) {
    path.unshift(curr);
    curr = curr.previous;
  }
  return path;
}

function constructBiPath(meetNode) {
    let pathA = [];
    let curr = meetNode;
    while(curr !== null) {
        pathA.unshift(curr);
        curr = curr.previous;
    }
    let pathB = [];
    curr = meetNode.previousEnd;
    while(curr !== null) {
        pathB.push(curr);
        curr = curr.previousEnd;
    }
    return pathA.concat(pathB);
}

/* ============================================================
   SECTION 8: ALGORITHMS (GRAPH LOGIC ONLY)
   ============================================================ */

function runBFS(start, end) {
  const visitedInOrder = [];
  const queue = [start];
  start.visited = true;

  while (queue.length > 0) {
    const curr = queue.shift();
    visitedInOrder.push({node: curr, secondary: false});

    if (curr === end) return { visitedInOrder, path: constructPath(end) };

    for (const edge of curr.edges) {
      const neighbor = edge.node;
      if (!neighbor.visited) {
        neighbor.visited = true;
        neighbor.previous = curr;
        queue.push(neighbor);
      }
    }
  }
  return { visitedInOrder, path: [] };
}

function runDFS(start, end) {
  const visitedInOrder = [];
  const stack = [start];
  
  while(stack.length > 0) {
      const curr = stack.pop();
      if(curr.visited) continue;
      
      curr.visited = true;
      visitedInOrder.push({node: curr, secondary: false});
      
      if(curr === end) return { visitedInOrder, path: constructPath(end) };
      
      for(const edge of curr.edges) {
          const neighbor = edge.node;
          if(!neighbor.visited) {
              neighbor.previous = curr;
              stack.push(neighbor);
          }
      }
  }
  return { visitedInOrder, path: [] };
}

function runDijkstra(start, end) {
  const visitedInOrder = [];
  start.distance = 0;
  
  // Using array sort queue for brevity - efficient enough for ~5k nodes
  const unvisited = [start];

  while (unvisited.length > 0) {
    unvisited.sort((a, b) => b.distance - a.distance);
    const curr = unvisited.pop();

    if (curr.visited) continue;
    curr.visited = true;
    visitedInOrder.push({node: curr, secondary: false});

    if (curr === end) return { visitedInOrder, path: constructPath(end) };

    for (const edge of curr.edges) {
      const neighbor = edge.node;
      if (!neighbor.visited) {
        const alt = curr.distance + edge.cost; // cost is metric distance
        if (alt < neighbor.distance) {
          neighbor.distance = alt;
          neighbor.previous = curr;
          if(!unvisited.includes(neighbor)) unvisited.push(neighbor);
        }
      }
    }
  }
  return { visitedInOrder, path: [] };
}

function runAStar(start, end) {
  const visitedInOrder = [];
  start.gCost = 0;
  start.hCost = getGeoCost(start, end);
  start.fCost = start.gCost + start.hCost;
  
  const openSet = [start];

  while (openSet.length > 0) {
    openSet.sort((a, b) => (b.fCost - a.fCost) || (b.hCost - a.hCost));
    const curr = openSet.pop();

    if (curr.visited) continue;
    curr.visited = true;
    visitedInOrder.push({node: curr, secondary: false});

    if (curr === end) return { visitedInOrder, path: constructPath(end) };

    for (const edge of curr.edges) {
      const neighbor = edge.node;
      if (neighbor.visited) continue;

      const altG = curr.gCost + edge.cost;
      if (altG < neighbor.gCost) {
        neighbor.previous = curr;
        neighbor.gCost = altG;
        neighbor.hCost = getGeoCost(neighbor, end);
        neighbor.fCost = neighbor.gCost + neighbor.hCost;
        
        if (!openSet.includes(neighbor)) openSet.push(neighbor);
      }
    }
  }
  return { visitedInOrder, path: [] };
}

function runGreedy(start, end) {
    const visitedInOrder = [];
    const openSet = [start];
    start.visited = true;
    
    while(openSet.length > 0) {
        openSet.sort((a,b) => getGeoCost(b, end) - getGeoCost(a, end));
        const curr = openSet.pop();
        
        visitedInOrder.push({node: curr, secondary: false});
        
        if(curr === end) return { visitedInOrder, path: constructPath(end) };
        
        for(const edge of curr.edges) {
            const neighbor = edge.node;
            if(!neighbor.visited) {
                neighbor.visited = true;
                neighbor.previous = curr;
                openSet.push(neighbor);
            }
        }
    }
    return { visitedInOrder, path: [] };
}

function runBiBFS(start, end) {
    const visitedInOrder = [];
    const queueA = [start];
    const queueB = [end];
    
    start.visitedBy = 'start';
    end.visitedBy = 'end';
    
    while(queueA.length > 0 && queueB.length > 0) {
        const currA = queueA.shift();
        visitedInOrder.push({node: currA, secondary: false});
        
        for(const edge of currA.edges) {
            const neighbor = edge.node;
            if(!neighbor.visitedBy) {
                neighbor.visitedBy = 'start';
                neighbor.previous = currA;
                queueA.push(neighbor);
            } else if (neighbor.visitedBy === 'end') {
                neighbor.previous = currA; 
                return { visitedInOrder, path: constructBiPath(neighbor) };
            }
        }
        
        const currB = queueB.shift();
        visitedInOrder.push({node: currB, secondary: true});
        
        for(const edge of currB.edges) {
            const neighbor = edge.node;
            if(!neighbor.visitedBy) {
                neighbor.visitedBy = 'end';
                neighbor.previousEnd = currB;
                queueB.push(neighbor);
            } else if (neighbor.visitedBy === 'start') {
                neighbor.previousEnd = currB; 
                return { visitedInOrder, path: constructBiPath(neighbor) };
            }
        }
    }
    return { visitedInOrder, path: [] };
}

// Start
window.onload = init;
