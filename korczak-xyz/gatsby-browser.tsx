import type { GatsbyBrowser } from 'gatsby';
import React from 'react';

import { ThemeProvider } from './src/context/ThemeContext';
import './src/styles/global.css';
import './src/styles/prism-dark.css';
import './src/styles/prism-light.css';

export const wrapRootElement: GatsbyBrowser['wrapRootElement'] = ({
  element,
}) => <ThemeProvider>{element}</ThemeProvider>;
