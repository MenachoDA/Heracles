import React from 'react';

export type EnrichmentViewType = 'po' | 'csf';

interface SidebarItem {
    id: EnrichmentViewType;
    label: string;
}

const SIDEBAR_ITEMS: SidebarItem[] = [
    { id: 'po', label: 'PO' },
    { id: 'csf', label: 'CSF' },
];

interface SidebarProps {
    activeView: EnrichmentViewType;
    onSelectView: (view: EnrichmentViewType) => void;
}

const Sidebar: React.FC<SidebarProps> = ({ activeView, onSelectView }) => {
    return (
        <aside className="w-56 bg-brand-blue min-h-screen flex flex-col py-8 px-4 gap-4 shadow-md shrink-0">
            {SIDEBAR_ITEMS.map((item) => {
                const isActive = activeView === item.id;
                return (
                    <button
                        key={item.id}
                        type="button"
                        onClick={() => onSelectView(item.id)}
                        className={`w-full py-3 px-6 rounded-lg transition-all text-center
                            ${isActive
                                ? 'bg-brand-yellow text-black font-bold shadow-md ring-2 ring-white'
                                : 'bg-white/85 text-gray-800 font-semibold shadow-sm hover:bg-brand-yellow hover:text-black'
                            }`}
                    >
                        {item.label}
                    </button>
                );
            })}

            {/* <button
                type="button"
                onClick={() => onSelectView('bn')}
                className="w-full py-3 px-6 rounded-lg transition-all text-center bg-white/85 text-gray-800 font-semibold shadow-sm hover:bg-brand-yellow hover:text-black"
            >
                Banca
            </button> */}
        </aside>
    );
};

export default Sidebar;
