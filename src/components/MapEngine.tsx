/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/ban-ts-comment */
import { useEffect, useRef, useCallback, memo, useState } from 'react';
import type { MapRef, MapLayerMouseEvent } from 'react-map-gl/maplibre';
import Map, { Marker, Source, Layer } from 'react-map-gl/maplibre';

import { motion, AnimatePresence } from 'framer-motion';
import type { Issue } from '../types';

interface MapEngineProps {
  issues: Issue[];
  onMarkerTap: (issue: Issue) => void;
  activeIssueId?: string | null;
  mlas?: any[];
  onMlaMarkerTap?: (mla: any) => void;
  activeMlaId?: number | null;
}

const CITY_COORDS: Record<string, [number, number]> = {
  'bengaluru': [77.5946, 12.9716],
  'bangalore': [77.5946, 12.9716],
  'delhi': [77.2090, 28.6139],
  'new delhi': [77.2090, 28.6139],
  'mumbai': [72.8777, 19.0760],
  'kolkata': [88.3639, 22.5726],
  'chennai': [80.2707, 13.0827],
  'hyderabad': [78.4867, 17.3850],
  'pune': [73.8567, 18.5204],
  'ahmedabad': [72.5714, 23.0225],
};

const getFallbackCoords = (city?: string, _state?: string, index: number = 0): [number, number] | null => {
  const normCity = city?.toLowerCase().trim() || '';
  if (CITY_COORDS[normCity]) {
    const [lng, lat] = CITY_COORDS[normCity];
    const angle = (index * 37) % 360;
    const distance = 0.015 + (index * 0.003) % 0.02;
    const rad = (angle * Math.PI) / 180;
    return [
      lng + Math.cos(rad) * distance,
      lat + Math.sin(rad) * distance
    ];
  }
  const angle = (index * 29) % 360;
  const distance = 0.08 + (index * 0.015) % 0.12;
  const rad = (angle * Math.PI) / 180;
  return [
    77.5946 + Math.cos(rad) * distance, // Default to staggering around Bengaluru area if no match
    12.9716 + Math.sin(rad) * distance
  ];
};

const MapEngine = memo(function MapEngine({ issues, onMarkerTap, activeIssueId, mlas, onMlaMarkerTap, activeMlaId }: MapEngineProps) {
  const mapRef = useRef<MapRef>(null);
  const [hasLocated, setHasLocated] = useState(false);
  const [hoverInfo, setHoverInfo] = useState<{ x: number, y: number, feature: any } | null>(null);

  // Request user geo-location on load to auto-zoom (triggered when map is ready)
  useEffect(() => {
    if (hasLocated || !mapRef.current) return;
    
    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition((position) => {
        const { longitude, latitude } = position.coords;
        setHasLocated(true);
        // Slightly delay the flyTo to ensure the map transition from splash is smooth
        setTimeout(() => {
          mapRef.current?.flyTo({
            center: [longitude, latitude],
            zoom: 12.5,
            pitch: 0,
            duration: 3500,
            essential: true
          });
        }, 800);
      }, (error) => {
        console.warn("Geolocation access denied or timed out:", error);
      }, { 
        enableHighAccuracy: true,
        timeout: 8000,
        maximumAge: 0 
      });
    }
  }, [hasLocated]);

  const onMapLoad = useCallback(() => {
    // Map instance is ready and style is loaded
  }, []);

  // Track previous issue to know when user hits "Back to Map"
  const prevIssueId = useRef(activeIssueId);

  useEffect(() => {
    // If transitioning from an active issue back to null (cleared selection)
    if (prevIssueId.current !== null && activeIssueId === null) {
      const currentCenter = mapRef.current?.getCenter();
      if (currentCenter) {
        mapRef.current?.flyTo({
          center: [currentCenter.lng, currentCenter.lat],
          zoom: 13, // City scale
          pitch: 0, // Flatten back to 2D
          bearing: 0,
          duration: 1200,
          essential: true
        });
      }
    }
    prevIssueId.current = activeIssueId;
  }, [activeIssueId]);

  const handleMarkerClick = useCallback((e: any, issue: Issue) => {
    e.originalEvent?.stopPropagation();
    
    // Fly to marker so it centers cleanly into the viewport
    mapRef.current?.flyTo({
      center: [issue.longitude, issue.latitude],
      zoom: 16.5,
      pitch: 60,
      bearing: 45,
      duration: 1000,
      offset: [0, -150] // Offset to keep marker visible above the bottom sheet
    });
    
    onMarkerTap(issue);
  }, [onMarkerTap]);

  const onHover = useCallback((event: MapLayerMouseEvent) => {
    const {
      features,
      point: {x, y}
    } = event;
    const hoveredFeature = features && features[0];

    if (hoveredFeature) {
      setHoverInfo({ feature: hoveredFeature, x, y });
    } else {
      setHoverInfo(null);
    }
  }, []);

  return (
    <div className="absolute inset-0 w-full h-full bg-[#111]">
      <AnimatePresence>
        {hoverInfo && (
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="absolute z-50 pointer-events-none bg-[#09090b]/95 backdrop-blur-xl border border-white/20 p-4 rounded-3xl shadow-[0_10px_40px_rgba(0,0,0,0.8)]"
            style={{ left: hoverInfo.x + 15, top: hoverInfo.y + 15 }}
          >
            <div className="mb-1 uppercase tracking-widest text-[10px] font-bold text-white/50">Ward {hoverInfo.feature.properties.ward_number}</div>
            <h3 className="font-bold text-lg leading-tight mb-2 text-white">{hoverInfo.feature.properties.ward_name}</h3>
            <div className="flex flex-col gap-1">
              <span className="block text-white/80 text-[11px]"><strong className="text-[#00D1FF] uppercase tracking-wider text-[9px] mr-1">MLA</strong> {hoverInfo.feature.properties.mla_name} ({hoverInfo.feature.properties.mla_party})</span>
              <span className="block text-white/80 text-[11px]"><strong className="text-[#00D1FF] uppercase tracking-wider text-[9px] mr-1">Zone</strong> {hoverInfo.feature.properties.zone}</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <Map
        ref={mapRef}
        initialViewState={{
          longitude: 76.5,
          latitude: 14.5,
          zoom: 6,
          pitch: 0,
          bearing: 0
        }}
        mapStyle="https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json"
        maxPitch={85}
        attributionControl={false}
        reuseMaps // Persists the map instance across re-renders/unmounts
        collectResourceTiming={false}
        maxTileCacheSize={150}
        fadeDuration={100}
        onLoad={onMapLoad}
        interactiveLayerIds={['wards-fill']}
        onMouseMove={onHover}
        onClick={onHover}
        onMouseLeave={() => window.matchMedia('(hover: hover)').matches && setHoverInfo(null)}
      >
        <Source id="wards" type="geojson" data="/wards.geojson">
          <Layer
            id="wards-fill"
            type="fill"
            paint={{
              'fill-color': '#00D1FF',
              'fill-opacity': 0.05
            }}
          />
          <Layer
            id="wards-line"
            type="line"
            paint={{
              'line-color': '#00D1FF',
              'line-width': 1,
              'line-opacity': 0.3
            }}
          />
        </Source>

        {issues.map((issue) => {
          let coreColor = 'bg-white';
          
          switch(issue.severity) {
            case 'critical': 
              coreColor = 'bg-[var(--color-danger-red)]'; 
              break;
            case 'high': 
              coreColor = 'bg-[#FF8C00]'; 
              break;
            case 'medium': 
              coreColor = 'bg-[var(--color-neon-amber)]'; 
              break;
            case 'low': 
              coreColor = 'bg-[#00FF41]'; 
              break;
            default:
              coreColor = 'bg-white';
          }

          const isActive = activeIssueId === issue.id;

          return (
            <Marker
              key={issue.id}
              longitude={issue.longitude}
              latitude={issue.latitude}
              anchor="center"
              onClick={(e) => handleMarkerClick(e, issue)}
            >
              <div className="relative flex items-center justify-center p-3 cursor-pointer group">
                <div 
                  className={`
                    w-4 h-4 rounded-full border-2 border-[var(--color-brand-bg)] 
                    ${coreColor}
                    transition-transform duration-300
                    ${issue.severity === 'critical' ? 'critical-pulse' : ''}
                    ${issue.severity === 'high' ? 'high-pulse' : ''}
                    ${isActive ? 'scale-[2.5] z-50' : 'scale-100 group-hover:scale-[1.5]'}
                  `} 
                />
              </div>
            </Marker>
          );
        })}

        {mlas && mlas.map((mla, idx) => {
          let lat = Number(mla.latitude);
          let lng = Number(mla.longitude);
          const hasCoords = lat && lng && Math.abs(lat) > 0.1 && Math.abs(lng) > 0.1;
          
          if (!hasCoords) {
            const fallback = getFallbackCoords(mla.city, mla.state, idx);
            if (fallback) {
              lng = fallback[0];
              lat = fallback[1];
            } else {
              return null;
            }
          }

          const isIncorrect = mla.is_incorrect || !mla.contact || mla.contact === 'Unknown' || mla.name?.includes('TBD');
          const markerBgColor = isIncorrect ? 'bg-red-600' : 'bg-emerald-600';
          const markerBorderColor = isIncorrect ? 'border-red-300' : 'border-emerald-300';
          const isActive = activeMlaId === mla.id;

          return (
            <Marker
              key={`mla-${mla.id}`}
              longitude={lng}
              latitude={lat}
              anchor="center"
              onClick={(e) => {
                e.originalEvent?.stopPropagation();
                mapRef.current?.flyTo({
                  center: [lng, lat],
                  zoom: 15.5,
                  duration: 1000,
                  offset: [0, -100]
                });
                if (onMlaMarkerTap) onMlaMarkerTap(mla);
              }}
            >
              <div className="relative flex items-center justify-center p-3 cursor-pointer group">
                <div 
                  className={`
                    w-6 h-6 rounded-full border-2 border-white/90 flex items-center justify-center text-[11px] font-black text-white shadow-[0_4px_12px_rgba(0,0,0,0.5)]
                    ${markerBgColor} ${markerBorderColor}
                    transition-all duration-300
                    ${isIncorrect ? 'animate-[pulse_1.5s_infinite]' : ''}
                    ${isActive ? 'scale-[2.2] z-50 ring-4 ring-white/60' : 'scale-100 group-hover:scale-[1.3]'}
                  `} 
                >
                  {isIncorrect ? '!' : '✓'}
                </div>
                
                {isIncorrect && (
                  <div className="absolute inset-0 rounded-full bg-red-600/30 scale-[1.7] animate-ping pointer-events-none" />
                )}
              </div>
            </Marker>
          );
        })}
      </Map>
    </div>
  );
});

export default MapEngine;
