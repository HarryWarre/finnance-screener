import { useEffect, useRef } from 'react';

export default function EconomicCalendar() {
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!container.current) return;
    
    container.current.innerHTML = '';
    
    const script = document.createElement("script");
    script.src = "https://s3.tradingview.com/external-embedding/embed-widget-events.js";
    script.type = "text/javascript";
    script.async = true;
    script.innerHTML = `
      {
        "colorTheme": "dark",
        "isTransparent": true,
        "width": "100%",
        "height": "100%",
        "locale": "vi_VN",
        "importanceFilter": "-1,0,1",
        "currencyFilter": "USD,EUR,JPY,GBP,AUD,CAD,CHF,NZD,CNY"
      }
    `;
    container.current.appendChild(script);
  }, []);

  return (
    <div className="tradingview-widget-container" ref={container} style={{ height: '100%', width: '100%' }}>
    </div>
  );
}
