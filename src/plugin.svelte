<script lang="ts">
  import { onMount } from 'svelte';
  import { store } from '@windy/store';
  import { map } from '@windy/map';
  import bcast from '@windy/bcast';

  const DEFAULT_ICS = "https://itinerary.rvlife.com/trips/ics/525823/UEVjWVFlczQ3MFFLSDhkNFJ3ZWdRUT09";
  const STORAGE_KEY = "windy_rv_ics_url";

  let icsUrl = DEFAULT_ICS;
  let itinerary: Array<{ summary: string; location: string; startDate: string; lat?: number; lon?: number }> = [];
  let loading = false;
  let errorMessage = '';

  onMount(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) icsUrl = saved;
    loadICS();
  });

  function parseICS(icsData: string) {
    const events = [];
    const lines = icsData.split(/\r\n|\n|\r/);
    let currentEvent: any = null;

    for (let line of lines) {
      if (line.startsWith('BEGIN:VEVENT')) {
        currentEvent = {};
      } else if (line.startsWith('END:VEVENT')) {
        if (currentEvent && (currentEvent.summary || currentEvent.location)) {
          events.push(currentEvent);
        }
        currentEvent = null;
      } else if (currentEvent) {
        if (line.startsWith('SUMMARY:')) currentEvent.summary = line.replace('SUMMARY:', '').trim();
        if (line.startsWith('LOCATION:')) currentEvent.location = line.replace('LOCATION:', '').trim();
        if (line.startsWith('DTSTART')) {
          const val = line.split(':')[1];
          if (val) {
            const yyyy = val.substring(0, 4);
            const mm = val.substring(4, 6);
            const dd = val.substring(6, 8);
            currentEvent.startDate = `${yyyy}-${mm}-${dd}`;
          }
        }
      }
    }
    return events;
  }

  async function loadICS() {
    loading = true;
    errorMessage = '';
    itinerary = [];
    localStorage.setItem(STORAGE_KEY, icsUrl);

    try {
      // Route through corsproxy.io to bypass browser CORS rules
     const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(icsUrl)}`;
      const res = await fetch(proxyUrl);

      if (!res.ok) throw new Error('Network error loading calendar.');

      const text = await res.text();
      const rawEvents = parseICS(text);

      const parsedStops = [];
      for (let ev of rawEvents) {
        const searchTarget = ev.location || ev.summary;
        if (!searchTarget) continue;

        // Geocode location using OpenStreetMap
        const geoRes = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(searchTarget)}`);
        const geoData = await geoRes.json();

        if (geoData.length > 0) {
          parsedStops.push({
            summary: ev.summary || searchTarget,
            location: ev.location,
            startDate: ev.startDate,
            lat: parseFloat(geoData[0].lat),
            lon: parseFloat(geoData[0].lon)
          });
        }
      }
      itinerary = parsedStops;
    } catch (e) {
      console.error(e);
      errorMessage = 'Failed to load ICS file. Check link or proxy availability.';
    } finally {
      loading = false;
    }
  }

  function selectStop(stop: any) {
    if (stop.lat && stop.lon) {
      map.setView([stop.lat, stop.lon], 8);
      bcast.fire('openDetail', { lat: stop.lat, lon: stop.lon });

      if (stop.startDate) {
        const targetDate = new Date(stop.startDate + "T12:00:00");
        if (!isNaN(targetDate.getTime())) {
          store.set('timestamp', targetDate.getTime());
        }
      }
    }
  }
</script>

<div class="plugin__content" style="padding: 10px; color: #fff;">
  <h3 style="color: #f39c12; margin-top: 0;">🚐 RV Trip Calendar</h3>
  
  <div style="margin-bottom: 12px;">
    <label style="font-size: 0.8rem; color: #aaa; display:block;">Your ICS Calendar Link:</label>
    <input type="text" bind:value={icsUrl} style="width: 100%; padding: 6px; margin-top: 4px; border-radius: 4px; background: #222; color: #fff; border: 1px solid #444;" />
    <button on:click={loadICS} style="margin-top: 6px; width: 100%; padding: 6px; background: #e74c3c; color: white; border: none; border-radius: 4px; font-weight: bold; cursor: pointer;">
      Sync Calendar
    </button>
  </div>

  {#if loading}
    <p style="color: #aaa;">Fetching itinerary...</p>
  {:else if errorMessage}
    <p style="color: #e74c3c;">{errorMessage}</p>
  {:else}
    <div style="display: flex; flex-direction: column; gap: 8px; max-height: 400px; overflow-y: auto;">
      {#each itinerary as stop}
        <div on:click={() => selectStop(stop)} style="background: #2a2a2a; padding: 10px; border-radius: 6px; border-left: 4px solid #3498db; cursor: pointer;">
          <div style="font-weight: bold; color: #3498db;">{stop.summary}</div>
          {#if stop.location}<div style="font-size: 0.8rem; color: #aaa;">📍 {stop.location}</div>{/if}
          <div style="font-size: 0.85rem; color: #e67e22; margin-top: 4px;">📅 {stop.startDate || 'No date'}</div>
        </div>
      {/each}
    </div>
  {/if}
</div>

