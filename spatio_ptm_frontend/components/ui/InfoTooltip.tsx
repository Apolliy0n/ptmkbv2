import React from "react";

export default function InfoTooltip({ text }: { text: string }) {
  return (
    <div className="group relative inline-flex ml-2 cursor-pointer items-center justify-center align-middle">
      <div className="w-5 h-5 rounded-full bg-slate-200 text-slate-500 flex items-center justify-center text-xs font-bold hover:bg-indigo-100 hover:text-indigo-600 transition-colors">?</div>
      <div className="absolute bottom-full mb-2 hidden group-hover:block w-64 p-3 bg-slate-800 text-white text-xs rounded-lg shadow-xl z-50 font-normal tracking-normal whitespace-normal">
        {text}
        <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-slate-800"></div>
      </div>
    </div>
  );
}