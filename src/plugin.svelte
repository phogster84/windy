<script lang="ts">
  import { onDestroy } from 'svelte';
  import store from '@windy/store';
  import { map } from '@windy/map';
  import L from '@windy/leaflet';
  import picker from '@windy/picker';
  import bcast from '@windy/bcast';

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
  let isCollapsed = false;

  // Custom high-visibility SVG pin marker icon
  const customPinIcon = L && typeof L.divIcon === 'function' ? L.divIcon({
    className: 'rv-custom-pin-wrapper',
    html: `
      <div style="
        background-color: #e53935;
        width: 28px;
        height: 28px;
        border-radius: 50% 50% 50% 0;
        transform: rotate(-45deg);
        border: 2px solid #ffffff;
        box-shadow: 0 3px 8px rgba(0,0,0,0.6);
        display: flex;
        align-items: center;
        justify-content: center;
      ">
        <div style="
          width: 10px;
          height: 10px;
          background-color: #ffffff;
          border-radius: 50%;
          transform: rotate(45deg);
        "></div>
      </div>
    `,
    iconSize: [28, 28],
    iconAnchor: [14, 28],
    popupAnchor: [0, -28]
  }) : null;

  onDestroy(() => {
    clearMarkers();
  });

  function clearMarkers() {
    markers.forEach((m) => map && map.removeLayer(m));
    markers = [];
  }

  function renderMarkers() {
    clearMarkers();
    if (!map || typeof L === 'undefined') return;

    itinerary.forEach((stop) => {
      const markerOptions = customPinIcon ? { icon: customPinIcon } : {};
      const marker = L.marker([stop.lat, stop.lon], markerOptions)
        .addTo(map)
        .bindPopup(`<b>${stop.summary}</b><br/>📅 ${stop.startDate}`);

      stop.marker = marker;
      markers.push(marker);
    });

    if (markers.length > 0) {
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

        itinerary = parseICS(text);

        if (itinerary.length === 0) {
          errorMessage = 'No stops found within the next 10 days.';
        } else {
          renderMarkers();
          // Automatically jump to first stop upon loading
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

    // 1. Center map on location
    if (map) {
      map.setView([stop.lat, stop.lon], 10);
    }

    // 2. Open marker popup pin
    if (stop.marker) {
      stop.marker.openPopup();
    }

    // 3. Sync timeline date
    if (stop.startDate && store) {
      const timestamp = stop.dateObj.getTime();
      if (!isNaN(timestamp)) {
        store.set('timestamp', timestamp);
      }
    }

    // 4. Open Windy's bottom weather detail pane
    try {
      if (picker && typeof picker.open === 'function') {
        picker.open({ lat: stop.lat, lon: stop.lon });
      }
      if (bcast) {
        bcast.fire('openDetail', { lat: stop.lat, lon: stop.lon });
      }
    } catch (e) {
      console.warn('Unable to trigger weather detail pane:', e);
    }
  }

  function toggleCollapse() {
    isCollapsed = !isCollapsed;
  }
</script>

<div class="rv-plugin-wrapper" class:collapsed={isCollapsed}>
  <!-- Collapsible Slide Toggle Tab -->
  <button
    class="collapse-toggle"
    on:click={toggleCollapse}
    title={isCollapsed ? "Expand Panel" : "Hide Panel"}
  >
    {isCollapsed ? '❮' : '❯'}
  </button>

  <div class="rv-plugin-container">
    <h3>RV Trip Weather</h3>

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
        <h4>Upcoming Stops ({itinerary.length})</h4>
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
</div>

<style>
  .rv-plugin-wrapper {
    position: relative;
    width: 320px;
    transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    box-sizing: border-box;
    z-index: 1000;
  }

  /* Slide panel off screen when collapsed to reveal Windy map layers */
  .rv-plugin-wrapper.collapsed {
    transform: translateX(calc(100% - 12px));
  }

  .collapse-toggle {
    position: absolute;
    left: -28px;
    top: 16px;
    width: 28px;
    height: 36px;
    background: rgba(22, 27, 34, 0.95);
    color: #2196f3;
    border: 1px solid rgba(255, 255, 255, 0.2);
    border-right: none;
    border-radius: 6px 0 0 6px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 14px;
    font-weight: bold;
    cursor: pointer;
    box-shadow: -4px 2px 8px rgba(0, 0, 0, 0.4);
    z-index: 1001;
  }

  .collapse-toggle:hover {
    background: #2196f3;
    color: #fff;
  }

  .rv-plugin-container {
    padding: 14px;
    font-size: 13px;
    color: #fff;
    background: rgba(22, 27, 34, 0.95);
    border-radius: 8px 0 0 8px;
    box-sizing: border-box;
    box-shadow: -4px 0 15px rgba(0, 0, 0, 0.5);
    height: auto;
  }

  h3 {
    margin-top: 0;
    margin-bottom: 12px;
    font-size: 15px;
    color: #fff;
  }

  h4 {
    margin: 12px 0 6px 0;
    color: #ddd;
    font-size: 12px;
  }

  .section {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  input[type='file'] {
    width: 100%;
    padding: 6px;
    border-radius: 4px;
    border: 1px solid #444;
    background: #111;
    color: #fff;
    box-sizing: border-box;
    font-size: 11px;
  }

  .error {
    color: #ff5252;
    margin-top: 10px;
    font-weight: bold;
  }

  .loading-state,
  .empty-state {
    margin-top: 12px;
    opacity: 0.7;
    font-style: italic;
  }

  .stops-list {
    margin-top: 10px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    /* Height fits content dynamically without forcing scrollbars */
    height: auto;
    overflow: visible;
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
    background: rgba(33, 150, 243, 0.3);
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
