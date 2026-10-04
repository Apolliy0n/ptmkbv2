// src/app/page.tsx
"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";

export default function HomePage() {
  const router = useRouter();
  const [uniprotId, setUniprotId] = useState("P04637"); // Defaults to p53

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (uniprotId.trim()) {
      router.push(`/proteins/${uniprotId.trim().toUpperCase()}`);
    }
  };

  return (
    <div className="max-w-xl mx-auto mt-24 p-10 bg-white border border-slate-200 rounded-xl shadow-sm text-center">
      <h2 className="text-3xl font-extrabold text-slate-800 mb-4 tracking-tight">
        Explore Structural Dynamics
      </h2>
      <p className="text-slate-500 mb-8 leading-relaxed">
        Enter a UniProt ID to instantly map thousands of Post-Translational Modifications onto 1D sequences and 3D crystal structures.
      </p>
      
      <form onSubmit={handleSearch} className="flex flex-col sm:flex-row gap-3">
        <input
          type="text"
          value={uniprotId}
          onChange={(e) => setUniprotId(e.target.value)}
          placeholder="e.g., P04637"
          className="flex-1 border border-slate-300 p-4 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent font-mono text-lg uppercase transition-all shadow-inner"
        />
        <button 
          type="submit"
          className="bg-indigo-600 text-white px-8 py-4 rounded-lg font-semibold hover:bg-indigo-700 transition-colors shadow-sm"
        >
          Analyze
        </button>
      </form>
    </div>
  );
}