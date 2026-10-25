// Colours for the 2D view. Copied from src/world/palette.ts on purpose: that file
// imports three.js at runtime, and the 2D bundle must stay light.
import type { Status } from '../../shared/protocol';
import type { ThemeName } from '../world/palette';
import { hsl, mix } from './color';

export type { ThemeName };

export const STATUS_COLORS: Record<Status, string> = {
  idle: '#8a94a6',
  thinking: '#38bdf8',
  working: '#3b82f6',
  waiting: '#f5a524',
  done: '#22c55e',
  error: '#ef4444',
  offline: '#5b6170',
};

export function hash(value: string) {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// Scarf colours by role (same table as the 3D shirts, so a role looks the same in both views).
const SHIRTS = ['#3d5a80', '#e07a5f', '#81b29a', '#f2cc8f', '#6d597a', '#457b9d', '#e76f51', '#2a9d8f', '#bc6c25', '#577590', '#d62828', '#4d908e'];
export function shirtFor(role: string) {
  const key = role.toLowerCase();
  return key === 'lead' ? '#ff5f2e' : SHIRTS[hash(key) % SHIRTS.length];
}

const CATS: { fur: string; belly: string; stripe: string; stripes: boolean }[] = [
  { fur: '#f4a259', belly: '#ffe3c0', stripe: '#d9803a', stripes: true },
  { fur: '#aab4c0', belly: '#f1f4f7', stripe: '#8792a0', stripes: true },
  { fur: '#f6f1ea', belly: '#ffffff', stripe: '#d8cfc4', stripes: false },
  { fur: '#5b5b70', belly: '#a5a5ba', stripe: '#44445a', stripes: true },
  { fur: '#f0dcae', belly: '#fff6e0', stripe: '#d9bf86', stripes: false },
  { fur: '#b9835a', belly: '#f0d9bf', stripe: '#8e5f3c', stripes: true },
  { fur: '#3a3a46', belly: '#6c6c7c', stripe: '#2a2a34', stripes: false },
  { fur: '#e8c4a0', belly: '#fff0e0', stripe: '#c79a72', stripes: true },
];
export function catFurFor(id: string) {
  return CATS[(hash(id) >>> 3) % CATS.length];
}

export const EYE_IRIS = ['#6aa7ff', '#6fcf97', '#f2b35a', '#b08cff'];

export interface Palette2D {
  dark: boolean;
  bg: string;
  bgEdge: string;
  outline: string;
  shadow: string;
  wall: string;
  lobby: string;
  corridor: string;
  gridLine: string;
  text: string;
  textSoft: string;
  plaque: string;
  plaqueText: string;
  wood: string;
  woodLight: string;
  metal: string;
  leaf: string;
  leafLight: string;
  pot: string;
  chairs: string[];
  sofa: string[];
  roomFloor(hue: number): string;
  rug(hue: number): string;
  accent(hue: number): string;
}

export const PALETTES2D: Record<ThemeName, Palette2D> = {
  light: {
    dark: false,
    bg: '#f7ecd9',
    bgEdge: '#f2e3cb',
    outline: '#8a6a5c',
    shadow: 'rgba(120,85,60,0.20)',
    wall: '#fffaf1',
    lobby: '#fdeed6',
    corridor: '#f5e2c4',
    gridLine: 'rgba(138,106,92,0.10)',
    text: '#5c4439',
    textSoft: '#8d7468',
    plaque: '#fffaf1',
    plaqueText: '#5c4439',
    wood: '#e7c59b',
    woodLight: '#f4dcb9',
    metal: '#c9d3df',
    leaf: '#8fd19e',
    leafLight: '#b6e8bd',
    pot: '#f0b08a',
    chairs: ['#c9b6f2', '#ffb8c9', '#a9e5cf', '#ffd9a6', '#a9d4ff'],
    sofa: ['#8fcfc4', '#ffb3a7', '#ffd68a', '#b8a6ee'],
    roomFloor: (h) => hsl(h, 0.62, 0.9),
    rug: (h) => hsl(h, 0.55, 0.8),
    accent: (h) => hsl(h, 0.65, 0.6),
  },
  dark: {
    dark: true,
    bg: '#171c36',
    bgEdge: '#10142a',
    outline: '#0b0e20',
    shadow: 'rgba(0,0,10,0.35)',
    wall: '#46507c',
    lobby: '#2d3558',
    corridor: '#283052',
    gridLine: 'rgba(160,175,255,0.07)',
    text: '#f1e7ff',
    textSoft: '#b2a9d4',
    plaque: '#3a4472',
    plaqueText: '#fff0d6',
    wood: '#8c6e5a',
    woodLight: '#a58570',
    metal: '#6c7aa3',
    leaf: '#4f9a7a',
    leafLight: '#6bb996',
    pot: '#b8805e',
    chairs: ['#8a78c8', '#c4708f', '#5fae95', '#c99a5c', '#6a97cf'],
    sofa: ['#4f9a96', '#c27a72', '#c4a15a', '#8571c2'],
    roomFloor: (h) => hsl(h, 0.26, 0.23),
    rug: (h) => hsl(h, 0.3, 0.3),
    accent: (h) => hsl(h, 0.7, 0.66),
  },
};

export function shade(c: string, dark: boolean, t = 0.18) {
  return dark ? mix(c, '#ffffff', t * 0.5) : mix(c, '#7a4f3a', t);
}
