
import React from 'react';
import ReactDOM from 'react-dom/client';
import MainApp from './MainApp';

// This wrapper ensures the root component is correctly identified by React
function App() { 
  return <MainApp />; 
}

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
