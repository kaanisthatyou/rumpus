export {
  Avatar,
  Badge,
  Button,
  Chip,
  Counter,
  IconButton,
  Kbd,
  LiveDot,
  Segmented,
  Spinner,
  Switch,
  TextField,
  Track,
} from './components.js';
export { Icon, type IconName, Mark } from './icons.js';
export { easeOut, popIn, slide, softSpring, spring, stagger } from './motion.js';

/** Accent swatches as shown in pickers; the CSS tokens are the source of truth for the app itself. */
export const ACCENT_SWATCHES = {
  lime: '#C6F24E',
  blue: '#7AA7FF',
  orange: '#FF8A5B',
  violet: '#A48BFF',
  teal: '#4FD8C4',
  rose: '#FF86AC',
  amber: '#FFC24B',
} as const;
