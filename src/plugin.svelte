<script lang="ts">
  import { onDestroy } from 'svelte';
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

  let loading = false;
  let errorMessage = '';
  let itinerary: Stop[] = [];
  let markers: any[] = [];
  let selectedStop: Stop | null = null;

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
      // Create interactive Leaflet marker pin
      const marker = L.marker([stop.lat, stop.lon])
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

  // Clean ICS line unwrapping and character unescaping
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
          errorMessage = 'No stops with valid coordinates found within the next 10 days.';
        } else {
          renderMarkers();
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

    // 1. Pan map to stop position
    if (map) {
      map.setView([stop.lat, stop.lon], 10);
    }

    // 2. Open map pin popup to direct attention
    if (stop.marker) {
      stop.marker.openPopup();
    }

    // 3. Set Windy timeline date
    if (stop.startDate && store) {
      const timestamp = stop.dateObj.getTime();
      if (!isNaN(timestamp)) {
        store.set('timestamp', timestamp);
      }
    }

    // 4. Open Windy's bottom detail forecast panel
    try {
      if (picker && typeof picker.open === 'function') {
        picker.open({ lat: stop.lat, lon: stop.lon });
      }
    } catch (e) {
      console.warn('Unable to open forecast picker:', e);
    }
  }
</script>

<div class="rv-plugin-container">
  <h3>RV Trip Weather (Next 10 Days)</h3>

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
    <div class="empty-state">Upload your `.ics` file to view upcoming trip weather.</div>
  {/if}
</div>

<style>
  .rv-plugin-container {
    padding: 14px;
    font-size: 13px;
    color: #fff;
    /* High opacity dark background to make text easily readable over map elements */
    background: rgba(22, 27, 34, 0.95);
    border-radius: 8px;
    box-sizing: border-box;
    height: 100%;
    box-shadow: -4px 0 15px rgba(0, 0, 0, 0.4);
  }

  h3 {
    margin-top: 0;
    margin-bottom: 12px;
    font-size: 16px;
    color: #fff;
  }

  h4 {
    margin: 12px 0 6px 0;
    color: #ddd;
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
    margin-top: 12px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    max-height: 480px;
    overflow-y: auto;
  }

  .stop-card {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid rgba(255, 255, 255, 0.15);
    padding: 10px;
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
    background: rgba(33, 150, 243, 0.25);
    border: 1px solid #2196f3;
  }

  .stop-title {
    font-weight: bold;
    font-size: 13px;
    color: #ffffff;
  }

  .stop-details {
    font-size: 11px;
    color: #ccc;
    margin-top: 4px;
  }
</style>
