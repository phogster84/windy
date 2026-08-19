<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import store from '@windy/store';
  import { map } from '@windy/map';
  import L from '@windy/leaflet';

  interface CalendarEvent {
    summary: string;
    location: string;
    startDate: string;
  }

  interface Stop {
    summary: string;
    location: string;
    startDate: string;
    lat: number;
    lon: number;
  }

  const STORAGE_KEY = 'rv_ics_url';

  let icsUrl = '';
  let loading = false;
  let errorMessage = '';
  let itinerary: Stop[] = [];
  let markers: any[] = [];

  onMount(() => {
    icsUrl = localStorage.getItem(STORAGE_KEY) || '';
  });

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
      const marker = L.marker([stop.lat, stop.lon])
        .addTo(map)
        .bindPopup(`<b>${stop.summary}</b><br/>${stop.startDate}`);
      markers.push(marker);
    });

    if (markers.length > 0) {
      const group = L.featureGroup(markers);
      map.fitBounds(group.getBounds().pad(0.2));
    }
  }

  // Parses raw .ics file strings into structured event objects
  function parseICS(icsText: string): CalendarEvent[] {
    const events: CalendarEvent[] = [];
    const eventBlocks = icsText.split('BEGIN:VEVENT');

    for (let i = 1; i < eventBlocks.length; i++) {
      const block = eventBlocks[i].split('END:VEVENT')[0];

      const summaryMatch = block.match(/SUMMARY(?:;[^:]*)?:(.*)/);
      const locationMatch = block.match(/LOCATION(?:;[^:]*)?:(.*)/);
      const dtstartMatch = block.match(/DTSTART(?:;[^:]*)?:(.*)/);

      const summary = summaryMatch ? summaryMatch[1].trim() : '';
      const location = locationMatch ? locationMatch[1].trim() : '';
      const rawDate = dtstartMatch ? dtstartMatch[1].trim() : '';

      let startDate = rawDate;
      if (rawDate.length >= 8) {
        const y = rawDate.slice(0, 4);
        const m = rawDate.slice(4, 6);
        const d = rawDate.slice(6, 8);
        startDate = `${y}-${m}-${d}`;
      }

      if (summary || location) {
        events.push({ summary, location, startDate });
      }
    }
    return events;
  }

  // Geocodes array of events using OpenStreetMap
  async function processEvents(rawEvents: CalendarEvent[]) {
    const parsedStops: Stop[] = [];

    for (let ev of rawEvents) {
      const searchTarget = ev.location || ev.summary;
      if (!searchTarget) continue;

      try {
        const geoRes = await fetch(
          `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(searchTarget)}`
        );
        const geoData = await geoRes.json();

        if (geoData && geoData.length > 0) {
          parsedStops.push({
            summary: ev.summary || searchTarget,
            location: ev.location,
            startDate: ev.startDate,
            lat: parseFloat(geoData[0].lat),
            lon: parseFloat(geoData[0].lon)
          });
        }
      } catch (err) {
        console.warn('Geocoding failed for:', searchTarget, err);
      }
    }
    return parsedStops;
  }

  // Handle local file upload (FileReader)
  function handleFileUpload(event: Event) {
    const target = event.target as HTMLInputElement;
    const file = target.files?.[0];
    if (!file) return;

    loading = true;
    errorMessage = '';

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const text = e.target?.result as string;
        if (!text || !text.includes('BEGIN:VCALENDAR')) {
          throw new Error('Invalid ICS file contents.');
        }

        const rawEvents = parseICS(text);
        itinerary = await processEvents(rawEvents);
        renderMarkers();
      } catch (err: any) {
        console.error(err);
        errorMessage = err.message || 'Error processing uploaded file.';
      } finally {
        loading = false;
      }
    };
    reader.readAsText(file);
  }

  // Handle fetching via URL through a proxy
  async function loadICS() {
    if (!icsUrl) return;
    loading = true;
    errorMessage = '';
    localStorage.setItem(STORAGE_KEY, icsUrl);

    try {
      const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(icsUrl)}`;
      const res = await fetch(proxyUrl);

      if (!res.ok) throw new Error(`Fetch failed with status ${res.status}`);

      const text = await res.text();
      if (!text.includes('BEGIN:VCALENDAR')) {
        throw new Error('Calendar link returned invalid data or was blocked.');
      }

      const rawEvents = parseICS(text);
      itinerary = await processEvents(rawEvents);
      renderMarkers();
    } catch (e: any) {
      console.error(e);
      errorMessage = e.message || 'Failed to fetch online ICS file.';
    } finally {
      loading = false;
    }
  }

  // Pan map and update Windy timeline when clicking a stop card
  function jumpToStop(stop: Stop) {
    if (map) {
      map.setView([stop.lat, stop.lon], 10);
    }
    if (stop.startDate && store) {
      const timestamp = new Date(stop.startDate).getTime();
      if (!isNaN(timestamp)) {
        store.set('timestamp', timestamp);
      }
    }
  }
</script>

<div class="rv-plugin-container">
  <h3>RV Trip Itinerary Weather</h3>

  <!-- Local File Upload Section -->
  <div class="section">
    <label for="ics-file"><strong>Upload .ics Calendar File:</strong></label>
    <input
      id="ics-file"
      type="file"
      accept=".ics"
      on:change={handleFileUpload}
      disabled={loading}
    />
  </div>

  <div class="divider">OR</div>

  <!-- URL Fetch Section -->
  <div class="section">
    <label for="ics-url"><strong>RV Life ICS URL:</strong></label>
    <input
      id="ics-url"
      type="text"
      bind:value={icsUrl}
      placeholder="https://..."
      disabled={loading}
    />
    <button on:click={loadICS} disabled={loading || !icsUrl}>
      {loading ? 'Processing...' : 'Load from Web'}
    </button>
  </div>

  {#if errorMessage}
    <div class="error">{errorMessage}</div>
  {/if}

  {#if loading}
    <div class="loading-state">Parsing calendar and geocoding stops...</div>
  {/if}

  <!-- Itinerary List Output -->
  {#if itinerary.length > 0}
    <div class="stops-list">
      <h4>Trip Stops ({itinerary.length})</h4>
      {#each itinerary as stop}
        <button class="stop-card" on:click={() => jumpToStop(stop)}>
          <div class="stop-title">{stop.summary}</div>
          <div class="stop-details">
            📅 {stop.startDate || 'No date'} | 📍 {stop.lat.toFixed(3)}, {stop.lon.toFixed(3)}
          </div>
        </button>
      {/each}
    </div>
  {:else if !loading}
    <div class="empty-state">Upload an .ics file to display your trip on Windy.</div>
  {/if}
</div>

<style>
  .rv-plugin-container {
    padding: 12px;
    font-size: 13px;
    color: #fff;
  }

  h3 {
    margin-top: 0;
    margin-bottom: 12px;
    font-size: 16px;
  }

  h4 {
    margin: 12px 0 6px 0;
  }

  .section {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  input[type='text'],
  input[type='file'] {
    width: 100%;
    padding: 6px;
    border-radius: 4px;
    border: 1px solid #555;
    background: #222;
    color: #fff;
    box-sizing: border-box;
  }

  button {
    padding: 8px;
    border-radius: 4px;
    border: none;
    background: #2196f3;
    color: white;
    font-weight: bold;
    cursor: pointer;
  }

  button:disabled {
    background: #555;
    cursor: not-allowed;
  }

  .divider {
    text-align: center;
    margin: 10px 0;
    font-weight: bold;
    opacity: 0.6;
    font-size: 11px;
  }

  .error {
    color: #ff5252;
    margin-top: 8px;
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
    max-height: 400px;
    overflow-y: auto;
  }

  .stop-card {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    background: rgba(255, 255, 255, 0.1);
    border: 1px solid rgba(255, 255, 255, 0.2);
    padding: 8px;
    border-radius: 4px;
    text-align: left;
    transition: background 0.2s;
  }

  .stop-card:hover {
    background: rgba(255, 255, 255, 0.25);
  }

  .stop-title {
    font-weight: bold;
    font-size: 13px;
  }

  .stop-details {
    font-size: 11px;
    opacity: 0.8;
    margin-top: 2px;
  }
</style>

