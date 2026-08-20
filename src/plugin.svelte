<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import store from '@windy/store';
  import { map } from '@windy/map';
  import L from '@windy/leaflet';
  import picker from '@windy/picker';

  interface Stop {
    summary: string;
    location: string;
    startDate: string;
    dateObj: Date;
    lat: number;
    lon: number;
    marker?: any;
  }

  const STORAGE_KEY = 'rv_trip_ics_data';

  let loading = false;
  let errorMessage = '';
  let itinerary: Stop[] = [];
  let markers: any[] = [];
  let selectedStop: Stop | null = null;
  let isMinimized = false;

  // Action to attach floating button directly to the document root (bypasses Windy CSS clipping)
  function teleport(node: HTMLElement) {
    document.body.appendChild(node);
    return {
      destroy() {
        if (node.parentNode) {
          node.parentNode.removeChild(node);
        }
      }
    };
  }

  onMount(() => {
    const savedIcs = localStorage.getItem(STORAGE_KEY);
    if (savedIcs) {
      try {
        itinerary = parseICS(savedIcs);
        if (itinerary.length > 0) {
          renderMarkers();
          jumpToStop(itinerary[0]);
        }
      } catch (e) {
        console.warn('Failed to load cached ICS data:', e);
      }
    }
  });

  onDestroy(() => {
    clearMarkers();
  });

  function clearMarkers() {
    markers.forEach((m) => map && map.removeLayer(m));
    markers = [];
  }

  // Pure SVG string rendering - bypasses all CSS scoping issues completely
  function createPinIcon(isActive: boolean) {
    if (!L || typeof L.divIcon !== 'function') return null;

    const pinColor = isActive ? '#00E676' : '#FF1744';
    const svgHtml = `
      <div style="position: relative; width: 30px; height: 30px; transform: translate(-50%, -100%);">
        <svg viewBox="0 0 24 24" width="30" height="30" style="filter: drop-shadow(0px 3px 4px rgba(0,0,0,0.6));">
          <path fill="${pinColor}" stroke="#FFFFFF" stroke-width="1.5" d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/>
          <circle cx="12" cy="9" r="3" fill="#FFFFFF"/>
        </svg>
      </div>
    `;

    return L.divIcon({
      html: svgHtml,
      className: '', // Empty className avoids Svelte class stripping
      iconSize: [30, 30],
      iconAnchor: [15, 30]
    });
  }

  function renderMarkers() {
    clearMarkers();
    if (!map || typeof L === 'undefined') return;

    itinerary.forEach((stop) => {
      const isActive = selectedStop === stop;
      const icon = createPinIcon(isActive);
      const markerOptions = icon ? { icon } : {};

      const marker = L.marker([stop.lat, stop.lon], markerOptions)
        .addTo(map)
        .bindPopup(`<b>${stop.summary}</b><br/>📅 ${stop.startDate}`);

      stop.marker = marker;
      markers.push(marker);

      if (isActive) {
        marker.openPopup();
      }
    });

    if (markers.length > 0 && !selectedStop) {
      const group = L.featureGroup(markers);
      map.fitBounds(group.getBounds().pad(0.2));
    }
  }

  function cleanIcsText(rawText: string): string {
    return rawText
      .replace(/\r\n[ \t]/g, '')
      .replace(/\\n/g, ' ')
      .replace(/\\,/g, ',')
      .replace(/\\;/g, ';');
  }

  function parseICS(icsText: string): Stop[] {
    const cleanedText = cleanIcsText(icsText);
    const eventBlocks = cleanedText.split('BEGIN:VEVENT');
    const parsedStops: Stop[] = [];

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (let i = 1; i < eventBlocks.length; i++) {
      const block = eventBlocks[i].split('END:VEVENT')[0];

      const summaryMatch = block.match(/SUMMARY(?:;[^:]*)?:(.*)/);
      const locationMatch = block.match(/LOCATION(?:;[^:]*)?:(.*)/);
      const dtstartMatch = block.match(/DTSTART(?:;[^:]*)?:(\d{8})/);
      const geoMatch = block.match(/GEO(?:;[^:]*)?:([0-9.-]+);([0-9.-]+)/);

      if (!geoMatch) continue;

      const lat = parseFloat(geoMatch[1]);
      const lon = parseFloat(geoMatch[2]);
      if (isNaN(lat) || isNaN(lon)) continue;

      const summary = summaryMatch ? summaryMatch[1].trim() : 'RV Stop';
      const location = locationMatch ? locationMatch[1].trim() : '';

      let startDateStr = 'No date';
      let eventDate: Date | null = null;

      if (dtstartMatch && dtstartMatch[1]) {
        const rawDate = dtstartMatch[1];
        const year = parseInt(rawDate.slice(0, 4), 10);
        const month = parseInt(rawDate.slice(4, 6), 10) - 1;
        const day = parseInt(rawDate.slice(6, 8), 10);

        eventDate = new Date(year, month, day);
        startDateStr = eventDate.toISOString().split('T')[0];
      }

      if (eventDate) {
        const diffInDays = (eventDate.getTime() - today.getTime()) / (1000 * 3600 * 24);
        if (diffInDays < 0 || diffInDays > 10) {
          continue;
        }
      }

      parsedStops.push({
        summary,
        location,
        startDate: startDateStr,
        dateObj: eventDate || new Date(),
        lat,
        lon
      });
    }

    return parsedStops.sort((a, b) => a.dateObj.getTime() - b.dateObj.getTime());
  }

  function handleFileUpload(event: Event) {
    const target = event.target as HTMLInputElement;
    const file = target.files?.[0];
    if (!file) return;

    loading = true;
    errorMessage = '';
    selectedStop = null;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target?.result as string;
        if (!text || !text.includes('BEGIN:VCALENDAR')) {
          throw new Error('Invalid ICS file format.');
        }

        localStorage.setItem(STORAGE_KEY, text);
        itinerary = parseICS(text);

        if (itinerary.length === 0) {
          errorMessage = 'No stops found within the next 10 days.';
        } else {
          renderMarkers();
          jumpToStop(itinerary[0]);
        }
      } catch (err: any) {
        console.error(err);
        errorMessage = err.message || 'Error parsing uploaded file.';
      } finally {
        loading = false;
      }
    };

    reader.readAsText(file);
  }

  function clearStoredData() {
    localStorage.removeItem(STORAGE_KEY);
    itinerary = [];
    selectedStop = null;
    clearMarkers();
  }

  function jumpToStop(stop: Stop) {
    selectedStop = stop;

    if (map) {
      map.setView([stop.lat, stop.lon], 10);
    }

    renderMarkers();

    if (stop.startDate && store) {
      const timestamp = stop.dateObj.getTime();
      if (!isNaN(timestamp)) {
        store.set('timestamp', timestamp);
      }
    }

    // Target the weather picker dot on map
    try {
      if (picker && typeof picker.open === 'function') {
        picker.open({ lat: stop.lat, lon: stop.lon });
      }
    } catch (e) {
      console.warn('Could not trigger picker:', e);
    }
  }

  function toggleMinimize() {
    isMinimized = !isMinimized;
  }
</script>

{#if isMinimized}
  <!-- Teleport action attaches button directly to body element -->
  <div use:teleport>
    <button class="expand-pill-root" on:click={toggleMinimize}>
      🚐 Show RV Weather
    </button>
  </div>
{:else}
  <div class="rv-plugin-container">
    <div class="header-row">
      <h3>RV Trip Weather</h3>
      <button class="toggle-btn" on:click={toggleMinimize} title="Hide panel">
        Hide ✖
      </button>
    </div>

    {#if itinerary.length === 0}
      <div class="section">
        <label for="ics-file"><strong>Upload RVLife .ics File:</strong></label>
        <input
          id="ics-file"
          type="file"
          accept=".ics"
          on:change={handleFileUpload}
          disabled={loading}
        />
      </div>
    {:else}
      <div class="saved-bar">
        <span>Loaded trip saved</span>
        <button class="clear-btn" on:click={clearStoredData}>Replace File</button>
      </div>
    {/if}

    {#if errorMessage}
      <div class="error">{errorMessage}</div>
    {/if}

    {#if loading}
      <div class="loading-state">Parsing itinerary...</div>
    {/if}

    {#if itinerary.length > 0}
      <div class="stops-list">
        <div class="stops-header">Upcoming Stops ({itinerary.length})</div>
        {#each itinerary as stop}
          <button
            class="stop-card"
            class:active={selectedStop === stop}
            on:click={() => jumpToStop(stop)}
          >
            <div class="stop-title">{stop.summary}</div>
            <div class="stop-details">
              📅 {stop.startDate} | 📍 {stop.lat.toFixed(3)}, {stop.lon.toFixed(3)}
            </div>
          </button>
        {/each}
      </div>
    {:else if !loading && !errorMessage}
      <div class="empty-state">Upload an `.ics` file to view trip weather.</div>
    {/if}
  </div>
{/if}

<style>
  :global(#plugin-rhpane),
  :global(.plugin-content) {
    background-color: #12161f !important;
    background: #12161f !important;
    opacity: 1 !important;
  }

  :global(.expand-pill-root) {
    position: fixed !important;
    top: 20px !important;
    right: 20px !important;
    z-index: 9999999 !important;
    background: #2196f3 !important;
    color: #ffffff !important;
    border: 2px solid #ffffff !important;
    padding: 10px 16px !important;
    border-radius: 24px !important;
    font-size: 13px !important;
    font-weight: bold !important;
    cursor: pointer !important;
    box-shadow: 0 4px 15px rgba(0, 0, 0, 0.6) !important;
  }

  .rv-plugin-container {
    padding: 12px;
    font-size: 13px;
    color: #fff;
    background: #12161f;
    box-sizing: border-box;
    width: 100%;
  }

  .header-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  h3 {
    margin: 0;
    font-size: 14px;
    color: #fff;
    font-weight: bold;
  }

  .toggle-btn {
    background: rgba(255, 255, 255, 0.12);
    border: 1px solid rgba(255, 255, 255, 0.25);
    color: #ff5252;
    padding: 3px 8px;
    border-radius: 4px;
    font-size: 11px;
    font-weight: bold;
    cursor: pointer;
  }

  .toggle-btn:hover {
    background: #ff5252;
    color: #fff;
  }

  .saved-bar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    background: rgba(33, 150, 243, 0.2);
    border: 1px solid rgba(33, 150, 243, 0.4);
    padding: 6px 10px;
    border-radius: 4px;
    margin-top: 8px;
    font-size: 11px;
  }

  .clear-btn {
    background: transparent;
    border: 1px solid #2196f3;
    color: #64b5f6;
    padding: 2px 6px;
    border-radius: 3px;
    font-size: 10px;
    cursor: pointer;
  }

  .clear-btn:hover {
    background: #2196f3;
    color: #fff;
  }

  .section {
    margin-top: 10px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  input[type='file'] {
    width: 100%;
    padding: 6px;
    border-radius: 4px;
    border: 1px solid #444;
    background: #000;
    color: #fff;
    box-sizing: border-box;
    font-size: 11px;
  }

  .error {
    color: #ff5252;
    margin-top: 8px;
    font-weight: bold;
  }

  .loading-state,
  .empty-state {
    margin-top: 10px;
    opacity: 0.7;
    font-style: italic;
  }

  .stops-list {
    margin-top: 10px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .stops-header {
    font-weight: bold;
    color: #ccc;
    font-size: 12px;
    margin-bottom: 2px;
  }

  .stop-card {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid rgba(255, 255, 255, 0.15);
    padding: 8px 10px;
    border-radius: 6px;
    text-align: left;
    cursor: pointer;
    transition: all 0.2s ease-in-out;
  }

  .stop-card:hover {
    background: rgba(255, 255, 255, 0.2);
    border-color: #2196f3;
  }

  .stop-card.active {
    background: rgba(33, 150, 243, 0.35);
    border: 1px solid #2196f3;
  }

  .stop-title {
    font-weight: bold;
    font-size: 12px;
    color: #ffffff;
  }

  .stop-details {
    font-size: 10px;
    color: #ccc;
    margin-top: 3px;
  }
</style>
