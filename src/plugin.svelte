<script lang="ts">
  import { onDestroy } from 'svelte';
  import store from '@windy/store';
  import { map } from '@windy/map';
  import L from '@windy/leaflet';
  import picker from '@windy/picker';
  import broadcast from '@windy/broadcast';

  interface Stop {
    summary: string;
    location: string;
    startDate: string;
    dateObj: Date;
    lat: number;
    lon: number;
    marker?: any;
  }

  let loading = false;
  let errorMessage = '';
  let itinerary: Stop[] = [];
  let markers: any[] = [];
  let selectedStop: Stop | null = null;
  let isMinimized = false;

  onDestroy(() => {
    clearMarkers();
  });

  function clearMarkers() {
    markers.forEach((m) => map && map.removeLayer(m));
    markers = [];
  }

  // Create SVG marker pin directly with Leaflet
  function createPinIcon(isActive: boolean) {
    if (!L || typeof L.divIcon !== 'function') return null;
    return L.divIcon({
      className: isActive ? 'rv-marker-pin active' : 'rv-marker-pin',
      iconSize: [26, 26],
      iconAnchor: [13, 26],
      popupAnchor: [0, -26]
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

      // Filter for stops within 10 days
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

  function jumpToStop(stop: Stop) {
    selectedStop = stop;

    // 1. Center map
    if (map) {
      map.setView([stop.lat, stop.lon], 10);
    }

    // 2. Refresh pins so active stop gets highlighted
    renderMarkers();

    // 3. Sync timeline date
    if (stop.startDate && store) {
      const timestamp = stop.dateObj.getTime();
      if (!isNaN(timestamp)) {
        store.set('timestamp', timestamp);
      }
    }

    // 4. Force open Windy's bottom forecast weather panel
    try {
      if (store) {
        store.set('pickerLocation', { lat: stop.lat, lon: stop.lon });
      }
      if (picker && typeof picker.open === 'function') {
        picker.open({ lat: stop.lat, lon: stop.lon });
      }
      if (broadcast && typeof broadcast.fire === 'function') {
        broadcast.fire('openDetail', { lat: stop.lat, lon: stop.lon });
      }
    } catch (e) {
      console.warn('Could not open weather detail panel:', e);
    }
  }

  function toggleMinimize() {
    isMinimized = !isMinimized;
  }
</script>

<div class="rv-plugin-container" class:minimized={isMinimized}>
  <!-- Header with integrated Minimize/Expand Toggle -->
  <div class="header-row">
    <h3>RV Trip Weather</h3>
    <button class="toggle-btn" on:click={toggleMinimize}>
      {isMinimized ? '➕ Show Panel' : '➖ Hide Panel'}
    </button>
  </div>

  {#if !isMinimized}
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
  {/if}
</div>

<style>
  /* 1. FORCE OPACITY ON WINDY'S PARENT CONTAINER */
  :global(#plugin-rhpane),
  :global(.plugin-content) {
    background-color: #12161f !important;
    background: #12161f !important;
    opacity: 1 !important;
  }

  /* 2. GLOBAL LEAFLET PIN STYLES (prevents Svelte from stripping dynamic classes) */
  :global(.rv-marker-pin) {
    width: 24px !important;
    height: 24px !important;
    border-radius: 50% 50% 50% 0 !important;
    background: #e53935 !important;
    position: absolute !important;
    transform: rotate(-45deg) !important;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.7) !important;
    border: 2px solid #ffffff !important;
  }

  :global(.rv-marker-pin::after) {
    content: '' !important;
    width: 8px !important;
    height: 8px !important;
    margin: 6px 0 0 6px !important;
    background: #ffffff !important;
    position: absolute !important;
    border-radius: 50% !important;
  }

  :global(.rv-marker-pin.active) {
    background: #00e676 !important; /* Bright green highlight for selected stop */
    transform: rotate(-45deg) scale(1.25) !important;
    z-index: 1000 !important;
  }

  /* 3. PLUGIN UI STYLES */
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
    background: rgba(255, 255, 255, 0.15);
    border: 1px solid rgba(255, 255, 255, 0.3);
    color: #2196f3;
    padding: 4px 8px;
    border-radius: 4px;
    font-size: 11px;
    font-weight: bold;
    cursor: pointer;
  }

  .toggle-btn:hover {
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
