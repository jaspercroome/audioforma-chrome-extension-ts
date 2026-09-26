import React from 'react';
import { defaultVisualSettings } from '../utils/consts';
import { HexColorPicker } from 'react-colorful';
import { useState } from 'react';
import { Cog6ToothIcon, XMarkIcon } from '@heroicons/react/24/solid';
import { VisualSettings } from '../utils/consts';
import { ColorScale } from '../utils/colors';
import { NOTE_COLORS_HEX } from '../utils/noteColors';
import { noteNames } from '../utils/consts';
import { fifthsIndex } from '../utils/notes';
import type { VisualStyle } from './VisualStage';

const STYLE_OPTIONS: Array<{ value: VisualStyle; label: string }> = [
  { value: 'orb', label: 'Orb' },
  { value: '3d', label: '3D' },
  { value: 'classic', label: 'Classic' },
];

// Pitch classes in circle-of-fifths order, for the orb colour legend.
const FIFTHS_ORDER = Object.values(noteNames).sort((a, b) => fifthsIndex(a) - fifthsIndex(b));
const pitchClassOf = (note: string) => Object.values(noteNames).indexOf(note as never);
import {
  interpolateCool,
  interpolateCubehelixDefault,
  interpolateInferno,
  interpolatePurples,
  interpolateWarm,
} from "d3-scale-chromatic";

interface ControlPanelProps {
  settings: VisualSettings;
  onChange: (settings: VisualSettings) => void;
  visualStyle: VisualStyle;
  onVisualStyleChange: (style: VisualStyle) => void;
  colorScale: ColorScale;
  onColorScaleChange: (scale: ColorScale) => void;
}

export const ControlPanel = ({ 
  settings, 
  onChange, 
  visualStyle, 
  onVisualStyleChange,
  colorScale,
  onColorScaleChange
}: ControlPanelProps) => {
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);

  const colorBars = new Array(40).fill(1).map((v, i) => (i + 1) / 40);
  const scaleOptions: Array<{
    name: ColorScale;
    scale: (t: number) => string;
  }> = [
    { name: "Rainbow - Cool", scale: interpolateCool },
    { name: "Rainbow - Warm", scale: interpolateWarm },
    { name: "Cubehelix", scale: interpolateCubehelixDefault },
    { name: "Inferno", scale: interpolateInferno },
    { name: "Purples", scale: interpolatePurples },
  ];

  return (
    <div
      style={{
        zIndex: 1000,
        top: '24px',
        right: '24px',
        position: 'absolute'
      }}
    >
      {/* Toggle Button */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        style={{
          width: '48px',
          height: '48px',
          borderRadius: '8px',
          backgroundColor: '#fff',
          boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
          transition: 'background-color 0.3s ease',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          color: '#666666',
          fontSize: '24px'
        }}
        aria-label="Toggle controls"
      >
        {isExpanded ? (
          <XMarkIcon style={{color: '#666666', width: '24px', height: '24px'}} />
        ) : (
          <Cog6ToothIcon style={{color: '#666666', width: '24px', height: '24px'}} />
        )}
      </button>

      {/* Control Panel */}
      <div 
        style={{
          position: 'absolute',
          top: '56px',
          right: '0',
          backgroundColor: 'rgba(255, 255, 255, 0.9)',
          backdropFilter: 'blur(10px)',
          padding: '16px',
          borderRadius: '8px',
          boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
          width: '256px',
          transition: 'all 0.2s ease-in-out',
          transformOrigin: 'top right',
          transform: isExpanded ? 'scale(1)' : 'scale(0.95)',
          opacity: isExpanded ? '1' : '0',
          pointerEvents: isExpanded ? 'auto' : 'none'
        }}
      >
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '12px'
        }}>
          <h3 style={{
            fontWeight: '600',
            color: '#1f2937',
            marginBottom: '8px'
          }}>Visual Controls</h3>
          
          {/* Visual Style Switcher */}
          <div style={{
            display: 'flex',
            gap: '8px',
            padding: '4px',
            backgroundColor: '#f3f4f6',
            borderRadius: '8px'
          }}>
            {STYLE_OPTIONS.map(({ value, label }) => (
              <button
                key={value}
                style={{
                  flex: 1,
                  padding: '4px 8px',
                  borderRadius: '6px',
                  fontSize: '14px',
                  transition: 'all 0.2s ease',
                  backgroundColor: visualStyle === value ? '#fff' : 'transparent',
                  boxShadow: visualStyle === value ? '0 1px 2px rgba(0,0,0,0.1)' : 'none',
                  color: visualStyle === value ? '#1f2937' : '#4b5563',
                  cursor: 'pointer',
                  border: 'none'
                }}
                onClick={() => onVisualStyleChange(value)}
              >
                {label}
              </button>
            ))}
          </div>

          {visualStyle === 'orb' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '14px', color: '#4b5563' }}>Mood lighting (experimental)</span>
                <input
                  type="checkbox"
                  checked={settings.orbMood}
                  onChange={(e) => onChange({ ...settings, orbMood: e.target.checked })}
                  style={{ width: '16px', height: '16px' }}
                />
              </label>
              <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '14px', color: '#4b5563' }}>Auto-rotate</span>
                <input
                  type="checkbox"
                  checked={settings.orbAutoRotate}
                  onChange={(e) => onChange({ ...settings, orbAutoRotate: e.target.checked })}
                  style={{ width: '16px', height: '16px' }}
                />
              </label>
              <div style={{ fontSize: '12px', color: '#6b7280', lineHeight: 1.45 }}>
                Each vein is a note, coloured by its place on the circle of fifths. Glow is volume;
                low notes hug the glass, high notes float further out. The inner light follows the
                harmonic centre, and mood lighting warms or cools the room as the harmony leans
                sharpward or flatward of home.
              </div>
              <div style={{ display: 'flex', gap: '2px' }}>
                {FIFTHS_ORDER.map((note) => (
                  <div key={note} style={{ flex: 1, textAlign: 'center' }}>
                    <div style={{ height: '10px', borderRadius: '2px', backgroundColor: NOTE_COLORS_HEX[pitchClassOf(note)] }} />
                    <span style={{ fontSize: '9px', color: '#6b7280' }}>{note}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Color Scale Selector (the orb colours notes by the circle of fifths instead) */}
          {visualStyle !== 'orb' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <span style={{ fontSize: '14px', color: '#4b5563' }}>Color Scale</span>
            {scaleOptions.map(({ name, scale }) => (
              <div
                key={`${name}-container`}
                style={{
                  width: '100%',
                  height: '20px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '8px',
                  cursor: 'pointer',
                  padding: '4px',
                  borderRadius: '4px',
                  border: colorScale === name ? '2px solid #1f2937' : 'none',
                  transition: 'background-color 0.2s ease'
                }}
                onClick={() => onColorScaleChange(name)}
              >
                <span style={{ fontSize: '12px', color: '#4b5563' }}>{name}</span>
                <div style={{ display: 'flex' }}>
                  {colorBars.map((v, i) => (
                    <div
                      key={`${name}-${i}`}
                      style={{
                        height: '12px',
                        width: '2px',
                        backgroundColor: scale(v),
                      }}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
          )}

          {visualStyle === '3d' && (
            <>
              {/* Toggle switches for 3D view */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: '14px', color: '#4b5563' }}>Show Color Bars</span>
                  <input
                    type="checkbox"
                    checked={settings.showKeySegments}
                    onChange={(e) => onChange({ ...settings, showKeySegments: e.target.checked })}
                    style={{ width: '16px', height: '16px' }}
                  />
                </label>
                
                <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: '14px', color: '#4b5563' }}>Show SoundFlower</span>
                  <input
                    type="checkbox"
                    checked={settings.showSoundFlower}
                    onChange={(e) => onChange({ ...settings, showSoundFlower: e.target.checked })}
                    style={{ width: '16px', height: '16px' }}
                  />
                </label>
                
                <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: '14px', color: '#4b5563' }}>Show Circle of Fifths</span>
                  <input
                    type="checkbox"
                    checked={settings.showCircleOfFifths}
                    onChange={(e) => onChange({ ...settings, showCircleOfFifths: e.target.checked })}
                    style={{ width: '16px', height: '16px' }}
                  />
                </label>

                {/* Color picker */}
                <div style={{ position: 'relative' }}>
                  <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: '14px', color: '#4b5563' }}>Bar Color</span>
                    <button
                      onClick={() => setShowColorPicker(!showColorPicker)}
                      style={{
                        width: '32px',
                        height: '32px',
                        borderRadius: '4px',
                        border: '1px solid #d1d5db',
                        backgroundColor: settings.keySegmentColor
                      }}
                    />
                  </label>
                  {showColorPicker && (
                    <div style={{ position: 'absolute', right: '0', marginTop: '8px', zIndex: 10 }}>
                      <div 
                        style={{
                          position: 'fixed',
                          inset: '0'
                        }}
                        onClick={() => setShowColorPicker(false)}
                      />
                      <div style={{ position: 'relative' }}>
                        <HexColorPicker
                          color={settings.keySegmentColor}
                          onChange={(color) => {
                            onChange({ ...settings, keySegmentColor: color });
                          }}
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* Sliders */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <label style={{ display: 'block' }}>
                    <span style={{ fontSize: '14px', color: '#4b5563' }}>Point Size</span>
                    <input
                      type="range"
                      min="0.01"
                      max="0.2"
                      step="0.01"
                      value={settings.pointSize}
                      onChange={(e) => onChange({ ...settings, pointSize: parseFloat(e.target.value) })}
                      style={{ width: '100%' }}
                    />
                  </label>
                  
                  <label style={{ display: 'block' }}>
                    <span style={{ fontSize: '14px', color: '#4b5563' }}>Stick Radius</span>
                    <input
                      type="range"
                      min="0.001"
                      max="0.05"
                      step="0.001"
                      value={settings.stickRadius}
                      onChange={(e) => onChange({ ...settings, stickRadius: parseFloat(e.target.value) })}
                      style={{ width: '100%' }}
                    />
                  </label>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}; 