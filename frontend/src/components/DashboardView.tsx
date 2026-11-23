import React, { useEffect, useState, useMemo, useCallback } from 'react';
import {
    FileSpreadsheet,
    Database,
    RefreshCw,
    TrendingUp,
    FolderUp,
    FolderDown,
    Calendar,
    BarChart3,
    Activity
} from 'lucide-react';
import {
    getDashboardStatsService,
    type DashboardStatsResponse,
    type DashboardFileMetadata
} from '../services/apiService';
import { formatBytes } from '../utils/fileHelpers';

interface DashboardViewProps {
    isActive: boolean;
    refreshTrigger: number;
}

type ProcessFilter = 'all' | 'po' | 'csf';
type SourceFilter = 'all' | 'outputs' | 'uploads';

interface DailyAggregated {
    date: string;
    label: string;
    uploadsFiles: number;
    outputsFiles: number;
    totalFiles: number;
    uploadsRecords: number;
    outputsRecords: number;
    totalRecords: number;
    poFiles: number;
    csfFiles: number;
    poRecords: number;
    csfRecords: number;
}

function formatDateLabel(dateStr: string): string {
    const parts = dateStr.split('-');
    if (parts.length !== 3) return dateStr;
    const months = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
    const mIdx = parseInt(parts[1], 10) - 1;
    const day = parts[2];
    return `${day} ${months[mIdx] || parts[1]}`;
}

function formatCompactNumber(val: number): string {
    if (val >= 1_000_000) return `${(val / 1_000_000).toFixed(2)}M`;
    if (val >= 10_000) return `${(val / 1_000).toFixed(1)}k`;
    if (val >= 1_000) return `${(val / 1_000).toFixed(2)}k`;
    return val.toLocaleString('en-US');
}

interface TimelineChartProps {
    title: string;
    subtitle: string;
    data: DailyAggregated[];
    mode: 'files' | 'records';
    sourceFilter: SourceFilter;
}

const TimelineChart: React.FC<TimelineChartProps> = ({
    title,
    subtitle,
    data,
    mode,
    sourceFilter
}) => {
    const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

    const width = 680;
    const height = 270;
    const padLeft = 64;
    const padRight = 28;
    const padTop = 28;
    const padBottom = 46;
    const plotW = width - padLeft - padRight;
    const plotH = height - padTop - padBottom;

    const seriesValues = useMemo(() => {
        return data.map((d) => {
            const uploadsVal = mode === 'files' ? d.uploadsFiles : d.uploadsRecords;
            const outputsVal = mode === 'files' ? d.outputsFiles : d.outputsRecords;
            const totalVal =
                sourceFilter === 'uploads'
                    ? uploadsVal
                    : sourceFilter === 'outputs'
                    ? outputsVal
                    : uploadsVal + outputsVal;
            return {
                ...d,
                uploadsVal,
                outputsVal,
                totalVal
            };
        });
    }, [data, mode, sourceFilter]);

    const maxVal = useMemo(() => {
        if (seriesValues.length === 0) return 10;
        let max = 0;
        for (const item of seriesValues) {
            if (sourceFilter === 'all') {
                max = Math.max(max, item.uploadsVal, item.outputsVal, item.totalVal);
            } else if (sourceFilter === 'uploads') {
                max = Math.max(max, item.uploadsVal);
            } else {
                max = Math.max(max, item.outputsVal);
            }
        }
        return max === 0 ? 10 : Math.ceil(max * 1.15);
    }, [seriesValues, sourceFilter]);

    const getX = (idx: number) => {
        if (seriesValues.length <= 1) return padLeft + plotW / 2;
        return padLeft + (idx / (seriesValues.length - 1)) * plotW;
    };

    const getY = (val: number) => {
        return padTop + plotH - (val / maxVal) * plotH;
    };

    const buildPath = (getter: (item: (typeof seriesValues)[number]) => number) => {
        if (seriesValues.length === 0) return '';
        return seriesValues
            .map((item, idx) => `${idx === 0 ? 'M' : 'L'} ${getX(idx).toFixed(1)} ${getY(getter(item)).toFixed(1)}`)
            .join(' ');
    };

    const buildAreaPath = (getter: (item: (typeof seriesValues)[number]) => number) => {
        if (seriesValues.length === 0) return '';
        const linePath = buildPath(getter);
        const firstX = getX(0).toFixed(1);
        const lastX = getX(seriesValues.length - 1).toFixed(1);
        const baseY = (padTop + plotH).toFixed(1);
        return `${linePath} L ${lastX} ${baseY} L ${firstX} ${baseY} Z`;
    };

    const yTicks = [0, 0.25, 0.5, 0.75, 1].map((t) => Math.round(maxVal * t));

    return (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 flex flex-col justify-between">
            <div className="flex flex-wrap items-start justify-between gap-2 mb-4">
                <div>
                    <div className="flex items-center gap-2">
                        <Activity size={18} className="text-brand-blue" />
                        <h3 className="text-base font-bold text-gray-800">{title}</h3>
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5">{subtitle}</p>
                </div>

                <div className="flex items-center gap-3 text-xs font-medium">
                    {(sourceFilter === 'all' || sourceFilter === 'outputs') && (
                        <span className="flex items-center gap-1.5 text-gray-700">
                            <span className="w-3 h-3 rounded-full bg-brand-blue inline-block"></span>
                            Outputs (Salida)
                        </span>
                    )}
                    {(sourceFilter === 'all' || sourceFilter === 'uploads') && (
                        <span className="flex items-center gap-1.5 text-gray-700">
                            <span className="w-3 h-3 rounded-full bg-amber-400 inline-block"></span>
                            Uploads (Entrada)
                        </span>
                    )}
                    {sourceFilter === 'all' && (
                        <span className="flex items-center gap-1.5 text-gray-700">
                            <span className="w-3 h-0.5 bg-emerald-500 inline-block"></span>
                            Total Día
                        </span>
                    )}
                </div>
            </div>

            {seriesValues.length === 0 ? (
                <div className="h-56 flex items-center justify-center text-gray-400 text-sm">
                    No hay datos registrados para los filtros seleccionados.
                </div>
            ) : (
                <div className="relative w-full">
                    <svg
                        viewBox={`0 0 ${width} ${height}`}
                        className="w-full h-auto overflow-visible select-none"
                    >
                        <defs>
                            <linearGradient id={`grad-outputs-${mode}`} x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor="#38b6ff" stopOpacity="0.32" />
                                <stop offset="100%" stopColor="#38b6ff" stopOpacity="0.02" />
                            </linearGradient>
                            <linearGradient id={`grad-uploads-${mode}`} x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.25" />
                                <stop offset="100%" stopColor="#f59e0b" stopOpacity="0.02" />
                            </linearGradient>
                        </defs>

                        {/* Grid lines & Y-axis labels */}
                        {yTicks.map((tickVal, idx) => {
                            const y = getY(tickVal);
                            return (
                                <g key={idx}>
                                    <line
                                        x1={padLeft}
                                        y1={y}
                                        x2={width - padRight}
                                        y2={y}
                                        stroke="#e2e8f0"
                                        strokeDasharray={idx === 0 ? undefined : '4 4'}
                                        strokeWidth="1"
                                    />
                                    <text
                                        x={padLeft - 8}
                                        y={y + 4}
                                        textAnchor="end"
                                        className="fill-gray-400 text-[11px]"
                                    >
                                        {mode === 'records' ? formatCompactNumber(tickVal) : tickVal}
                                    </text>
                                </g>
                            );
                        })}

                        {/* Area fills */}
                        {(sourceFilter === 'all' || sourceFilter === 'uploads') && (
                            <path
                                d={buildAreaPath((d) => d.uploadsVal)}
                                fill={`url(#grad-uploads-${mode})`}
                            />
                        )}
                        {(sourceFilter === 'all' || sourceFilter === 'outputs') && (
                            <path
                                d={buildAreaPath((d) => d.outputsVal)}
                                fill={`url(#grad-outputs-${mode})`}
                            />
                        )}

                        {/* Lines */}
                        {sourceFilter === 'all' && (
                            <path
                                d={buildPath((d) => d.totalVal)}
                                fill="none"
                                stroke="#10b981"
                                strokeWidth="2"
                                strokeDasharray="5 3"
                            />
                        )}
                        {(sourceFilter === 'all' || sourceFilter === 'uploads') && (
                            <path
                                d={buildPath((d) => d.uploadsVal)}
                                fill="none"
                                stroke="#f59e0b"
                                strokeWidth="2.5"
                            />
                        )}
                        {(sourceFilter === 'all' || sourceFilter === 'outputs') && (
                            <path
                                d={buildPath((d) => d.outputsVal)}
                                fill="none"
                                stroke="#38b6ff"
                                strokeWidth="3"
                            />
                        )}

                        {/* Data points & X-axis labels */}
                        {seriesValues.map((item, idx) => {
                            const x = getX(idx);
                            const yOut = getY(item.outputsVal);
                            const yUp = getY(item.uploadsVal);
                            const yTot = getY(item.totalVal);
                            const isHovered = hoveredIdx === idx;

                            return (
                                <g
                                    key={item.date}
                                    onMouseEnter={() => setHoveredIdx(idx)}
                                    onMouseLeave={() => setHoveredIdx(null)}
                                    className="cursor-pointer"
                                >
                                    {/* Vertical guide on hover */}
                                    {isHovered && (
                                        <line
                                            x1={x}
                                            y1={padTop}
                                            x2={x}
                                            y2={padTop + plotH}
                                            stroke="#94a3b8"
                                            strokeWidth="1"
                                            strokeDasharray="3 3"
                                        />
                                    )}

                                    {/* X-axis date label */}
                                    <text
                                        x={x}
                                        y={padTop + plotH + 20}
                                        textAnchor="middle"
                                        className={`text-[11px] ${
                                            isHovered ? 'fill-gray-900 font-bold' : 'fill-gray-500 font-medium'
                                        }`}
                                    >
                                        {item.label}
                                    </text>

                                    {/* Total point */}
                                    {sourceFilter === 'all' && (
                                        <circle
                                            cx={x}
                                            cy={yTot}
                                            r={isHovered ? 5 : 3.5}
                                            fill="#10b981"
                                            stroke="#ffffff"
                                            strokeWidth="1.5"
                                        />
                                    )}

                                    {/* Uploads point */}
                                    {(sourceFilter === 'all' || sourceFilter === 'uploads') && (
                                        <>
                                            <circle
                                                cx={x}
                                                cy={yUp}
                                                r={isHovered ? 6 : 4.5}
                                                fill="#f59e0b"
                                                stroke="#ffffff"
                                                strokeWidth="2"
                                            />
                                            <text
                                                x={x}
                                                y={yUp - 9}
                                                textAnchor="middle"
                                                className="fill-amber-700 text-[10px] font-bold"
                                            >
                                                {mode === 'records'
                                                    ? formatCompactNumber(item.uploadsVal)
                                                    : item.uploadsVal}
                                            </text>
                                        </>
                                    )}

                                    {/* Outputs point */}
                                    {(sourceFilter === 'all' || sourceFilter === 'outputs') && (
                                        <>
                                            <circle
                                                cx={x}
                                                cy={yOut}
                                                r={isHovered ? 6 : 4.5}
                                                fill="#38b6ff"
                                                stroke="#ffffff"
                                                strokeWidth="2"
                                            />
                                            <text
                                                x={x}
                                                y={
                                                    sourceFilter === 'all' && Math.abs(yOut - yUp) < 14
                                                        ? yOut + 15
                                                        : yOut - 9
                                                }
                                                textAnchor="middle"
                                                className="fill-sky-700 text-[10px] font-bold"
                                            >
                                                {mode === 'records'
                                                    ? formatCompactNumber(item.outputsVal)
                                                    : item.outputsVal}
                                            </text>
                                        </>
                                    )}

                                    {/* Invisible wider hit area */}
                                    <rect
                                        x={x - 24}
                                        y={padTop}
                                        width={48}
                                        height={plotH + 25}
                                        fill="transparent"
                                    />
                                </g>
                            );
                        })}
                    </svg>

                    {/* Tooltip Card */}
                    {hoveredIdx !== null && seriesValues[hoveredIdx] && (
                        <div className="mt-2 px-3 py-2 bg-slate-800 text-white text-xs rounded-lg shadow-md flex flex-wrap items-center justify-between gap-3">
                            <span className="font-semibold flex items-center gap-1.5">
                                <Calendar size={13} className="text-brand-yellow" />
                                Fecha: {seriesValues[hoveredIdx].date}
                            </span>
                            <div className="flex items-center gap-4">
                                <span className="text-sky-300">
                                    Outputs:{' '}
                                    <strong className="text-white">
                                        {seriesValues[hoveredIdx].outputsVal.toLocaleString('en-US')}
                                    </strong>
                                </span>
                                <span className="text-amber-300">
                                    Uploads:{' '}
                                    <strong className="text-white">
                                        {seriesValues[hoveredIdx].uploadsVal.toLocaleString('en-US')}
                                    </strong>
                                </span>
                                <span className="text-emerald-300">
                                    Total Día:{' '}
                                    <strong className="text-white">
                                        {seriesValues[hoveredIdx].totalVal.toLocaleString('en-US')}
                                    </strong>
                                </span>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

interface QuantityChartProps {
    title: string;
    subtitle: string;
    uploadsPo: number;
    uploadsCsf: number;
    outputsPo: number;
    outputsCsf: number;
    unitLabel: string;
    sourceFilter: SourceFilter;
    processFilter: ProcessFilter;
}

const QuantityChart: React.FC<QuantityChartProps> = ({
    title,
    subtitle,
    uploadsPo,
    uploadsCsf,
    outputsPo,
    outputsCsf,
    unitLabel,
    sourceFilter,
    processFilter
}) => {
    const filteredUploadsPo = processFilter === 'csf' ? 0 : uploadsPo;
    const filteredUploadsCsf = processFilter === 'po' ? 0 : uploadsCsf;
    const filteredOutputsPo = processFilter === 'csf' ? 0 : outputsPo;
    const filteredOutputsCsf = processFilter === 'po' ? 0 : outputsCsf;

    const totalUploads = sourceFilter === 'outputs' ? 0 : filteredUploadsPo + filteredUploadsCsf;
    const totalOutputs = sourceFilter === 'uploads' ? 0 : filteredOutputsPo + filteredOutputsCsf;
    const totalPo =
        (sourceFilter === 'outputs' ? 0 : filteredUploadsPo) +
        (sourceFilter === 'uploads' ? 0 : filteredOutputsPo);
    const totalCsf =
        (sourceFilter === 'outputs' ? 0 : filteredUploadsCsf) +
        (sourceFilter === 'uploads' ? 0 : filteredOutputsCsf);

    const grandTotal = totalUploads + totalOutputs;

    const bars = [
        {
            label: 'Outputs (Salida)',
            po: sourceFilter === 'uploads' ? 0 : filteredOutputsPo,
            csf: sourceFilter === 'uploads' ? 0 : filteredOutputsCsf,
            total: totalOutputs,
            color: 'bg-brand-blue'
        },
        {
            label: 'Uploads (Entrada)',
            po: sourceFilter === 'outputs' ? 0 : filteredUploadsPo,
            csf: sourceFilter === 'outputs' ? 0 : filteredUploadsCsf,
            total: totalUploads,
            color: 'bg-amber-400'
        }
    ];

    const maxBar = Math.max(1, totalOutputs, totalUploads, totalPo, totalCsf);

    // Donut percentages by Process (PO vs CSF)
    const poPct = grandTotal > 0 ? (totalPo / grandTotal) * 100 : 0;
    const csfPct = grandTotal > 0 ? (totalCsf / grandTotal) * 100 : 0;
    const radius = 44;
    const circumference = 2 * Math.PI * radius;
    const csfStroke = (csfPct / 100) * circumference;
    const poStroke = (poPct / 100) * circumference;

    return (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 flex flex-col justify-between">
            <div className="flex items-start justify-between gap-2 mb-4">
                <div>
                    <div className="flex items-center gap-2">
                        <BarChart3 size={18} className="text-brand-blue" />
                        <h3 className="text-base font-bold text-gray-800">{title}</h3>
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5">{subtitle}</p>
                </div>
                <div className="text-right">
                    <span className="text-xs text-gray-400 uppercase font-semibold">Total {unitLabel}</span>
                    <p className="text-xl font-extrabold text-gray-800">
                        {grandTotal.toLocaleString('en-US')}
                    </p>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-12 gap-5 items-center my-auto">
                {/* Horizontal Stacked / Grouped Bars */}
                <div className="md:col-span-7 space-y-4">
                    {bars.map((bar) => {
                        const widthPct = Math.max(2, Math.round((bar.total / maxBar) * 100));
                        const barPoPct = bar.total > 0 ? (bar.po / bar.total) * 100 : 0;
                        const barCsfPct = bar.total > 0 ? (bar.csf / bar.total) * 100 : 0;

                        return (
                            <div key={bar.label} className="space-y-1.5">
                                <div className="flex justify-between text-xs font-semibold text-gray-700">
                                    <span>{bar.label}</span>
                                    <span>{bar.total.toLocaleString('en-US')} {unitLabel.toLowerCase()}</span>
                                </div>
                                <div className="w-full h-7 bg-slate-100 rounded-lg overflow-hidden p-0.5">
                                    {bar.total > 0 ? (
                                        <div
                                            className="h-full flex rounded-md overflow-hidden transition-all duration-500"
                                            style={{ width: `${widthPct}%` }}
                                        >
                                            {bar.csf > 0 && (
                                                <div
                                                    style={{ width: `${barCsfPct}%` }}
                                                    className="bg-brand-blue h-full flex items-center justify-center text-[10px] font-bold text-white px-1 truncate"
                                                    title={`CSF: ${bar.csf.toLocaleString('en-US')}`}
                                                >
                                                    {barCsfPct > 18 ? `CSF (${bar.csf.toLocaleString('en-US')})` : ''}
                                                </div>
                                            )}
                                            {bar.po > 0 && (
                                                <div
                                                    style={{ width: `${barPoPct}%` }}
                                                    className="bg-brand-yellow h-full flex items-center justify-center text-[10px] font-bold text-gray-900 px-1 truncate"
                                                    title={`PO: ${bar.po.toLocaleString('en-US')}`}
                                                >
                                                    {barPoPct > 18 ? `PO (${bar.po.toLocaleString('en-US')})` : ''}
                                                </div>
                                            )}
                                        </div>
                                    ) : (
                                        <div className="h-full flex items-center px-2 text-[11px] text-gray-400">
                                            0
                                        </div>
                                    )}
                                </div>
                                <div className="flex items-center justify-between text-[11px] text-gray-500">
                                    <span>
                                        CSF: <strong className="text-gray-700">{bar.csf.toLocaleString('en-US')}</strong>
                                    </span>
                                    <span>
                                        PO: <strong className="text-gray-700">{bar.po.toLocaleString('en-US')}</strong>
                                    </span>
                                </div>
                            </div>
                        );
                    })}
                </div>

                {/* Donut chart for PO vs CSF breakdown */}
                <div className="md:col-span-5 flex flex-col items-center justify-center border-t md:border-t-0 md:border-l border-gray-100 pt-4 md:pt-0 md:pl-4">
                    <div className="relative w-28 h-28 flex items-center justify-center">
                        <svg viewBox="0 0 110 110" className="w-28 h-28 -rotate-90">
                            <circle
                                cx="55"
                                cy="55"
                                r={radius}
                                fill="transparent"
                                stroke="#f1f5f9"
                                strokeWidth="13"
                            />
                            {grandTotal > 0 && (
                                <>
                                    <circle
                                        cx="55"
                                        cy="55"
                                        r={radius}
                                        fill="transparent"
                                        stroke="#38b6ff"
                                        strokeWidth="13"
                                        strokeDasharray={`${csfStroke} ${circumference}`}
                                        strokeDashoffset="0"
                                    />
                                    <circle
                                        cx="55"
                                        cy="55"
                                        r={radius}
                                        fill="transparent"
                                        stroke="#ffde59"
                                        strokeWidth="13"
                                        strokeDasharray={`${poStroke} ${circumference}`}
                                        strokeDashoffset={-csfStroke}
                                    />
                                </>
                            )}
                        </svg>
                        <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
                            <span className="text-[10px] text-gray-400 font-semibold uppercase">CSF / PO</span>
                            <span className="text-xs font-extrabold text-gray-800">
                                {Math.round(csfPct)}% / {Math.round(poPct)}%
                            </span>
                        </div>
                    </div>

                    <div className="mt-2 flex items-center gap-4 text-xs">
                        <div className="flex items-center gap-1.5">
                            <span className="w-3 h-3 rounded-sm bg-brand-blue inline-block"></span>
                            <span className="text-gray-600">
                                CSF: <strong className="text-gray-800">{totalCsf.toLocaleString('en-US')}</strong>
                            </span>
                        </div>
                        <div className="flex items-center gap-1.5">
                            <span className="w-3 h-3 rounded-sm bg-brand-yellow inline-block border border-amber-300"></span>
                            <span className="text-gray-600">
                                PO: <strong className="text-gray-800">{totalPo.toLocaleString('en-US')}</strong>
                            </span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

const DashboardView: React.FC<DashboardViewProps> = ({ isActive, refreshTrigger }) => {
    const [stats, setStats] = useState<DashboardStatsResponse | null>(null);
    const [loading, setLoading] = useState<boolean>(false);
    const [error, setError] = useState<string>('');
    const [processFilter, setProcessFilter] = useState<ProcessFilter>('all');
    const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');

    const fetchDashboardStats = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            const data = await getDashboardStatsService();
            setStats(data);
        } catch (err: unknown) {
            const axiosErr = err as { response?: { data?: { error?: string } } };
            setError(
                axiosErr.response?.data?.error ||
                    'No se pudieron cargar las métricas del Dashboard. Verifica que el backend esté activo.'
            );
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchDashboardStats();
    }, [fetchDashboardStats, refreshTrigger]);

    useEffect(() => {
        if (isActive) {
            fetchDashboardStats();
        }
    }, [isActive, fetchDashboardStats]);

    // Recalculate timeline and filtered files based on processFilter and sourceFilter
    const filteredFiles = useMemo<DashboardFileMetadata[]>(() => {
        if (!stats) return [];
        return stats.files.filter((f) => {
            if (processFilter !== 'all' && f.processType !== processFilter) return false;
            if (sourceFilter !== 'all' && f.source !== sourceFilter) return false;
            return true;
        });
    }, [stats, processFilter, sourceFilter]);

    const filteredTimeline = useMemo<DailyAggregated[]>(() => {
        if (!stats) return [];
        const dayMap = new Map<string, DailyAggregated>();

        for (const f of stats.files) {
            if (processFilter !== 'all' && f.processType !== processFilter) continue;

            if (!dayMap.has(f.date)) {
                dayMap.set(f.date, {
                    date: f.date,
                    label: formatDateLabel(f.date),
                    uploadsFiles: 0,
                    outputsFiles: 0,
                    totalFiles: 0,
                    uploadsRecords: 0,
                    outputsRecords: 0,
                    totalRecords: 0,
                    poFiles: 0,
                    csfFiles: 0,
                    poRecords: 0,
                    csfRecords: 0
                });
            }

            const entry = dayMap.get(f.date)!;
            if (f.source === 'uploads') {
                entry.uploadsFiles += 1;
                entry.uploadsRecords += f.rows;
            } else {
                entry.outputsFiles += 1;
                entry.outputsRecords += f.rows;
            }
            entry.totalFiles = entry.uploadsFiles + entry.outputsFiles;
            entry.totalRecords = entry.uploadsRecords + entry.outputsRecords;

            if (f.processType === 'po') {
                entry.poFiles += 1;
                entry.poRecords += f.rows;
            } else {
                entry.csfFiles += 1;
                entry.csfRecords += f.rows;
            }
        }

        return Array.from(dayMap.values()).sort((a, b) => a.date.localeCompare(b.date));
    }, [stats, processFilter]);

    if (!isActive) {
        return null;
    }

    const summary = stats?.summary;

    return (
        <section className="w-full max-w-6xl mx-auto flex flex-col gap-6 pb-10">
            {/* Header & Controls */}
            <header className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 bg-white p-5 rounded-xl border border-gray-200 shadow-sm">
                <div>
                    <h1 className="text-2xl font-bold text-gray-800">
                        Dashboard de Procesamiento (PO & CSF)
                    </h1>
                    <p className="text-sm text-gray-500 mt-0.5">
                        Métricas generadas en tiempo real a partir de los metadatos de las carpetas{' '}
                        <code className="bg-slate-100 px-1.5 py-0.5 rounded text-gray-700 font-mono text-xs">
                            outputs
                        </code>{' '}
                        y{' '}
                        <code className="bg-slate-100 px-1.5 py-0.5 rounded text-gray-700 font-mono text-xs">
                            uploads
                        </code>
                    </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                    {/* Process Filter */}
                    <div className="inline-flex rounded-lg border border-gray-200 bg-slate-50 p-1 text-xs font-semibold">
                        {(
                            [
                                { id: 'all', label: 'Todos (PO + CSF)' },
                                { id: 'csf', label: 'Solo CSF' },
                                { id: 'po', label: 'Solo PO' }
                            ] as const
                        ).map((tab) => (
                            <button
                                key={tab.id}
                                type="button"
                                onClick={() => setProcessFilter(tab.id)}
                                className={`px-2.5 py-1.5 rounded-md transition-all ${
                                    processFilter === tab.id
                                        ? 'bg-brand-yellow text-black shadow-sm font-bold'
                                        : 'text-gray-600 hover:text-black'
                                }`}
                            >
                                {tab.label}
                            </button>
                        ))}
                    </div>

                    {/* Source Filter */}
                    <div className="inline-flex rounded-lg border border-gray-200 bg-slate-50 p-1 text-xs font-semibold">
                        {(
                            [
                                { id: 'all', label: 'Uploads + Outputs' },
                                { id: 'outputs', label: 'Outputs' },
                                { id: 'uploads', label: 'Uploads' }
                            ] as const
                        ).map((tab) => (
                            <button
                                key={tab.id}
                                type="button"
                                onClick={() => setSourceFilter(tab.id)}
                                className={`px-2.5 py-1.5 rounded-md transition-all ${
                                    sourceFilter === tab.id
                                        ? 'bg-brand-blue text-white shadow-sm font-bold'
                                        : 'text-gray-600 hover:text-black'
                                }`}
                            >
                                {tab.label}
                            </button>
                        ))}
                    </div>

                    <button
                        type="button"
                        onClick={fetchDashboardStats}
                        disabled={loading}
                        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white border border-gray-200 text-xs font-semibold text-gray-700 hover:bg-slate-50 transition-all shadow-sm disabled:opacity-50"
                        title="Actualizar datos"
                    >
                        <RefreshCw size={14} className={loading ? 'animate-spin text-brand-blue' : ''} />
                        Actualizar
                    </button>
                </div>
            </header>

            {error && (
                <div className="p-4 bg-red-100 text-red-700 border border-red-200 rounded-xl text-sm font-medium">
                    {error}
                </div>
            )}

            {/* KPI Cards */}
            {summary && (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm flex items-center gap-3.5">
                        <div className="p-3 rounded-lg bg-sky-100 text-brand-blue">
                            <FolderDown size={22} />
                        </div>
                        <div>
                            <p className="text-xs text-gray-500 font-medium">Archivos en Outputs</p>
                            <p className="text-2xl font-extrabold text-gray-800">
                                {summary.outputsFiles.toLocaleString('en-US')}
                            </p>
                            <p className="text-[11px] text-gray-400">
                                CSF: {summary.csfOutputsFiles} | PO: {summary.poOutputsFiles}
                            </p>
                        </div>
                    </div>

                    <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm flex items-center gap-3.5">
                        <div className="p-3 rounded-lg bg-amber-100 text-amber-600">
                            <FolderUp size={22} />
                        </div>
                        <div>
                            <p className="text-xs text-gray-500 font-medium">Archivos en Uploads</p>
                            <p className="text-2xl font-extrabold text-gray-800">
                                {summary.uploadsFiles.toLocaleString('en-US')}
                            </p>
                            <p className="text-[11px] text-gray-400">
                                CSF: {summary.csfUploadsFiles} | PO: {summary.poUploadsFiles} ({summary.rawUploadsFilesOnDisk} arch. en disco)
                            </p>
                        </div>
                    </div>

                    <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm flex items-center gap-3.5">
                        <div className="p-3 rounded-lg bg-emerald-100 text-emerald-600">
                            <Database size={22} />
                        </div>
                        <div>
                            <p className="text-xs text-gray-500 font-medium">Registros en Outputs</p>
                            <p className="text-2xl font-extrabold text-gray-800">
                                {summary.outputsRecords.toLocaleString('en-US')}
                            </p>
                            <p className="text-[11px] text-gray-400">
                                CSF: {summary.csfOutputsRecords.toLocaleString('en-US')} | PO: {summary.poOutputsRecords.toLocaleString('en-US')}
                            </p>
                        </div>
                    </div>

                    <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm flex items-center gap-3.5">
                        <div className="p-3 rounded-lg bg-purple-100 text-purple-600">
                            <TrendingUp size={22} />
                        </div>
                        <div>
                            <p className="text-xs text-gray-500 font-medium">Registros en Uploads</p>
                            <p className="text-2xl font-extrabold text-gray-800">
                                {summary.uploadsRecords.toLocaleString('en-US')}
                            </p>
                            <p className="text-[11px] text-gray-400">
                                CSF: {summary.csfUploadsRecords.toLocaleString('en-US')} | PO: {summary.poUploadsRecords.toLocaleString('en-US')}
                            </p>
                        </div>
                    </div>
                </div>
            )}

            {/* 4 Main Charts Grid */}
            {summary && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {/* 1. Cantidad de archivos que procesaron */}
                    <QuantityChart
                        title="1. Cantidad de Archivos Procesados"
                        subtitle="Distribución de archivos en carpetas outputs y uploads por proceso (CSF / PO)"
                        uploadsPo={summary.poUploadsFiles}
                        uploadsCsf={summary.csfUploadsFiles}
                        outputsPo={summary.poOutputsFiles}
                        outputsCsf={summary.csfOutputsFiles}
                        unitLabel="Archivos"
                        sourceFilter={sourceFilter}
                        processFilter={processFilter}
                    />

                    {/* 2. Línea de tiempo para saber cuántos archivos se procesaron por día */}
                    <TimelineChart
                        title="2. Línea de Tiempo: Archivos Procesados por Día"
                        subtitle="Evolución diaria de archivos procesados en outputs y uploads"
                        data={filteredTimeline}
                        mode="files"
                        sourceFilter={sourceFilter}
                    />

                    {/* 3. Cantidad de registros que se procesaron */}
                    <QuantityChart
                        title="3. Cantidad de Registros Procesados"
                        subtitle="Volumen de filas procesadas en carpetas outputs y uploads por proceso (CSF / PO)"
                        uploadsPo={summary.poUploadsRecords}
                        uploadsCsf={summary.csfUploadsRecords}
                        outputsPo={summary.poOutputsRecords}
                        outputsCsf={summary.csfOutputsRecords}
                        unitLabel="Registros"
                        sourceFilter={sourceFilter}
                        processFilter={processFilter}
                    />

                    {/* 4. Línea de tiempo para saber cuántos registros se procesaron por día */}
                    <TimelineChart
                        title="4. Línea de Tiempo: Registros Procesados por Día"
                        subtitle="Evolución diaria de registros procesados en outputs y uploads"
                        data={filteredTimeline}
                        mode="records"
                        sourceFilter={sourceFilter}
                    />
                </div>
            )}

            {/* Metadata Table from outputs and uploads */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <FileSpreadsheet size={18} className="text-brand-blue" />
                        <h3 className="text-base font-bold text-gray-800">
                            Metadatos de Archivos ({filteredFiles.length})
                        </h3>
                    </div>
                    <span className="text-xs text-gray-400">
                        Fuente: /backend/outputs y /backend/uploads
                    </span>
                </div>

                <div className="overflow-x-auto max-h-80">
                    <table className="w-full text-left border-collapse text-xs">
                        <thead className="bg-slate-50 text-gray-600 sticky top-0 border-b border-gray-200">
                            <tr>
                                <th className="py-2.5 px-4 font-semibold">Archivo</th>
                                <th className="py-2.5 px-4 font-semibold">Carpeta</th>
                                <th className="py-2.5 px-4 font-semibold">Proceso</th>
                                <th className="py-2.5 px-4 font-semibold">Fecha</th>
                                <th className="py-2.5 px-4 font-semibold text-right">Registros</th>
                                <th className="py-2.5 px-4 font-semibold text-right">Tamaño</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {filteredFiles.map((file) => (
                                <tr key={file.id} className="hover:bg-slate-50/80 transition-colors">
                                    <td className="py-2.5 px-4 font-medium text-gray-800 max-w-xs truncate" title={file.rawName}>
                                        {file.name}
                                    </td>
                                    <td className="py-2.5 px-4">
                                        <span
                                            className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                                                file.source === 'outputs'
                                                    ? 'bg-sky-100 text-sky-800'
                                                    : 'bg-amber-100 text-amber-800'
                                            }`}
                                        >
                                            {file.source}
                                        </span>
                                    </td>
                                    <td className="py-2.5 px-4">
                                        <span
                                            className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold uppercase ${
                                                file.processType === 'po'
                                                    ? 'bg-brand-yellow text-gray-900'
                                                    : 'bg-brand-blue text-white'
                                            }`}
                                        >
                                            {file.processType}
                                        </span>
                                    </td>
                                    <td className="py-2.5 px-4 text-gray-600">{file.date}</td>
                                    <td className="py-2.5 px-4 text-right font-semibold text-gray-800">
                                        {file.rows.toLocaleString('en-US')}
                                    </td>
                                    <td className="py-2.5 px-4 text-right text-gray-500">
                                        {formatBytes(file.size)}
                                    </td>
                                </tr>
                            ))}
                            {filteredFiles.length === 0 && (
                                <tr>
                                    <td colSpan={6} className="py-8 text-center text-gray-400">
                                        No se encontraron archivos en outputs o uploads.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </section>
    );
};

export default DashboardView;
