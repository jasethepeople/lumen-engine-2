import { useEffect, useState } from 'react';
import { handleUpgrade, STRIPE_PRICES } from '../platform/billing';

interface TemplateItem {
  id: string;
  name: string;
  description: string;
  priceId: string;
  priceDisplay: string;
}

const TEMPLATES: TemplateItem[] = [
  {
    id: 'nocturne-folio',
    name: 'Nocturne — Folio',
    description: 'A paid cinematic portfolio with a two-act reveal.',
    priceId: STRIPE_PRICES.NOCTURNE_FOLIO,
    priceDisplay: '19.00 USD'
  }
];

export function Marketplace() {
  const [purchasedItems, setPurchasedItems] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const items: Record<string, boolean> = {};
    TEMPLATES.forEach(t => {
      items[t.id] = localStorage.getItem(`purchased_${t.id}`) === 'true';
    });
    setPurchasedItems(items);
  }, []);

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-white">Marketplace</h1>
        <button 
          onClick={() => {
            localStorage.clear();
            window.location.reload();
          }}
          className="text-xs bg-neutral-800 hover:bg-neutral-700 text-neutral-400 px-3 py-1.5 rounded transition-colors cursor-pointer"
        >
          Reset Session Cache
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {TEMPLATES.map((template) => {
          const isOwned = purchasedItems[template.id];
          return (
            <div key={template.id} className="bg-neutral-900 border border-neutral-800 p-5 rounded-lg flex flex-col justify-between">
              <div>
                <div className="flex justify-between items-start mb-2">
                  <h3 className="text-lg font-semibold text-white">{template.name}</h3>
                  <span className="text-xs bg-amber-500/10 text-amber-400 border border-amber-500/20 px-2 py-0.5 rounded font-mono">
                    {template.priceDisplay}
                  </span>
                </div>
                <p className="text-sm text-neutral-400 mb-6">{template.description}</p>
              </div>

              <div>
                {isOwned ? (
                  <button 
                    disabled
                    className="w-full bg-emerald-600/20 border border-emerald-500/30 text-emerald-400 font-medium py-2 px-4 rounded cursor-default flex items-center justify-center gap-2"
                  >
                    <span>✓ OWNED</span>
                  </button>
                ) : (
                  <button 
                    onClick={() => handleUpgrade(template.priceId)}
                    className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-medium py-2 px-4 rounded transition-colors cursor-pointer flex items-center justify-center gap-2"
                  >
                    <span>Buy {template.priceDisplay}</span>
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
