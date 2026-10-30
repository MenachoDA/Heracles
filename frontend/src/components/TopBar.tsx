import React from 'react';

interface TopBarProps {
    onAction: (type: 'po' | 'csf' | 'bn') => void;
    isDisabled: boolean;
}

const TopBar: React.FC<TopBarProps> = ({ onAction, isDisabled }) => {
    return (
        <div className="w-full bg-brand-blue h-32 flex items-center justify-center gap-12 shadow-md">
            <button
                onClick={() => onAction('po')}
                disabled={isDisabled}
                className={`bg-brand-yellow text-black font-semibold py-3 px-8 rounded-lg shadow-sm transition-all
                    ${isDisabled ? 'opacity-50 cursor-not-allowed' : 'hover:scale-105 hover:shadow-lg active:scale-95'}`}
            >
                Enriquecer PO
            </button>

            <button
                onClick={() => onAction('csf')}
                disabled={isDisabled}
                className={`bg-brand-yellow text-black font-semibold py-3 px-8 rounded-lg shadow-sm transition-all
                    ${isDisabled ? 'opacity-50 cursor-not-allowed' : 'hover:scale-105 hover:shadow-lg active:scale-95'}`}
            >
                Enriquecer Base CSF
            </button>

            <button
                onClick={() => onAction('bn')}
                disabled={isDisabled}
                className={`bg-brand-yellow text-black font-semibold py-3 px-8 rounded-lg shadow-sm transition-all
                    ${isDisabled ? 'opacity-50 cursor-not-allowed' : 'hover:scale-105 hover:shadow-lg active:scale-95'}`}
            >
                Enriquecer Base Banca
            </button>
        </div>
    );
};

export default TopBar;