<script lang="ts">
  import { onDestroy } from 'svelte';
  import store from '@windy/store';
  import { map } from '@windy/map';
  import L from '@windy/leaflet';

  interface Stop {
    summary: string;
    location: string;
    startDate: string;
    dateObj: Date;
    lat: number;
    lon: number;
  }

  let loading = false;
  let errorMessage = '';
  let itinerary: Stop[] = [];
  let markers: any[] = [];

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
        .bindPopup(`<b>${stop.summary}</b><br/>📅 ${stop.startDate}`);
      markers.push(marker);
    });

    if (markers.length > 0) {
      const group = L.featureGroup(markers);
      map.fitBounds(group.getBounds().pad(0.2));
    }
  }

  // Clean ICS text formatting (unfolds wrapped lines and unescapes characters)
  function cleanIcsText(rawText: string): string {
    return rawText
      .replace(/\r\n[ \t]/g, '') // Unfold multiline ICS properties
      .replace(/\\n/g, ' ')       // Replace encoded linebreaks
      .replace(/\\,/g, ',')       // Unescape commas
      .replace(/\\;/g, ';');      // Unescape semicolons
  }

  function parseICS(icsText: string): Stop[] {
    const cleanedText = cleanIcsText(icsText);
    const eventBlocks = cleanedText.split('BEGIN:VEVENT');
    const parsedStops: Stop[] = [];

    const today = new Date();
    today.setHours(0, 0, 0, 0); // Midnight baseline for accurate date comparison

    for (let i = 1; i < eventBlocks.length; i++) {
      const block = eventBlocks[i].split('END:VEVENT')[0];

      // Extract SUMMARY, LOCATION, DTSTART, and GEO
      const summaryMatch = block.match(/SUMMARY(?:;[^:]*)?:(.*)/);
      const locationMatch = block.match(/LOCATION(?:;[^:]*)?:(.*)/);
      const dtstartMatch = block.match(/DTSTART(?:;[^:]*)?:(\d{8})/);
      const geoMatch = block.match(/GEO(?:;[^:]*)?:([0-9.-]+);([0-9.-]+)/);

      // We need valid coordinates to plot on map
      if (!geoMatch) continue;

      const lat = parseFloat(geoMatch[1]);
      const lon = parseFloat(geoMatch[2]);
      if (isNaN(lat) || isNaN(lon)) continue;

      const summary = summaryMatch ? summaryMatch[1].trim() : 'RV Stop';
      const location = locationMatch ? locationMatch[1].trim() : '';

      // Date parsing (YYYYMMDD)
      let startDateStr = 'No date';
      let eventDate: Date | null = null;

      if (dtstartMatch && dtstartMatch[1]) {
        const rawDate = dtstartMatch[1];
        const year = parseInt(rawDate.slice(0, 4), 10);
        const month = parseInt(rawDate.slice(4, 6), 10) - 1; // Month is 0-indexed in JS
        const day = parseInt(rawDate.slice(6, 8), 10);

        eventDate = new Date(year, month, day);
        startDateStr = eventDate.toISOString().split('T')[0];
      }

      // 10-Day Date Filtering Logic
      if (eventDate) {
        // Calculate difference in days from today
        const diffInTime = eventDate.getTime() - today.getTime();
        const diffInDays = diffInTime / (1000 * 3600 * 24);

        // Filter: Keep stops occurring within the next 10 days (or currently active within 10 days)
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

    // Sort stops chronologically
    return parsedStops.sort((a, b) => a.dateObj.getTime() - b.dateObj.getTime());
  }

  function handleFileUpload(event: Event) {
    const target = event.target as HTMLInputElement;
    const file = target.files?.[0];
    if (!file) return;

    loading = true;
    errorMessage = '';

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target?.result as string;
        if (!text || !text.includes('BEGIN:VCALENDAR')) {
          throw new Error('Invalid ICS file. Ensure this is an RVLife export.');
        }

        itinerary = parseICS(text);

        if (itinerary.length === 0) {
          errorMessage = 'No stops with valid coordinates found within 10 days of today.';
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
    if (map) {
      map.setView([stop.lat, stop.lon], 10);
    }
    if (stop.startDate && store) {
      const timestamp = stop.dateObj.getTime();
      if (!isNaN(timestamp)) {
        store.set('timestamp', timestamp);
      }
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
        <button class="stop-card" on:click={() => jumpToStop(stop)}>
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
    padding: 12px;
    font-size: 13px;
    color: #fff;
  }

  h3 {
    margin-top: 0;
    margin-bottom: 12px;
    font-size: 15px;
  }

  h4 {
    margin: 12px 0 6px 0;
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
    border: 1px solid #555;
    background: #222;
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
    max-height: 420px;
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
    cursor: pointer;
    transition: background 0.2s;
  }

  .stop-card:hover {
    background: rgba(255, 255, 255, 0.25);
  }

  .stop-title {
    font-weight: bold;
    font-size: 13px;
    color: #fff;
  }

  .stop-details {
    font-size: 11px;
    opacity: 0.8;
    margin-top: 2px;
    color: #ddd;
  }
</style>
