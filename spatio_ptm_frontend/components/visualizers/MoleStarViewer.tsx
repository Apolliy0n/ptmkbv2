"use client";
import React, { useEffect, useRef, useState } from 'react';
import { createPluginUI } from 'molstar/lib/mol-plugin-ui';
import { renderReact18 } from 'molstar/lib/mol-plugin-ui/react18';
import { DefaultPluginUISpec } from 'molstar/lib/mol-plugin-ui/spec';
import type { PluginUIContext } from 'molstar/lib/mol-plugin-ui/context';
import { PluginSpec } from 'molstar/lib/mol-plugin/spec';
import {
  MAQualityAssessment,
  QualityAssessmentPLDDTPreset,
} from 'molstar/lib/extensions/model-archive/quality-assessment/behavior';
import { MolScriptBuilder as MS } from 'molstar/lib/mol-script/language/builder';
import { Script } from 'molstar/lib/mol-script/script';
import { StructureSelection, StructureElement, StructureProperties } from 'molstar/lib/mol-model/structure';
import { Color } from 'molstar/lib/mol-util/color';
import { useDashboardStore } from '../../lib/store';
import 'molstar/build/viewer/molstar.css';

const PTM_COLORS: Record<string, number> = {
  Phosphorylation: 0xe11d48,
  Acetylation: 0x16a34a,
  Ubiquitination: 0x9333ea,
  Methylation: 0xea580c,
  Lactylation: 0xdb2777,
  Glutathionylation: 0x0d9488,
  'S-nitrosylation': 0xca8a04,
  'O-linked Glycosylation': 0x0891b2,
};
const DEFAULT_COLOR = 0x111827;

const residueExpr = (positions: number[]) =>
  MS.struct.generator.atomGroups({
    'residue-test': MS.core.set.has([
      MS.set(...positions),
      MS.struct.atomProperty.macromolecular.label_seq_id(),
    ]),
  });

interface Props {
  uniprotId: string;
  sites: any[];
}

export default function MolstarViewer({ uniprotId, sites }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const pluginRef = useRef<PluginUIContext | null>(null);
  const siteRefs = useRef<string[]>([]);
  const [ready, setReady] = useState(false);

  const selectedPosition = useDashboardStore((s) => s.selectedPosition);
  const setSelectedPosition = useDashboardStore((s) => s.setSelectedPosition);

  // ---- init + load structure ----
  useEffect(() => {
    if (!hostRef.current || !uniprotId) return;
    let disposed = false;
    let plugin: PluginUIContext | null = null;
    let sub: { unsubscribe: () => void } | null = null;

    const target = document.createElement('div');
    target.style.width = '100%';
    target.style.height = '100%';
    hostRef.current.appendChild(target);

    (async () => {
      const spec = DefaultPluginUISpec();
      spec.behaviors.push(PluginSpec.Behavior(MAQualityAssessment));
      spec.layout = { initial: { isExpanded: false, showControls: false } };

      const p = await createPluginUI({ target, render: renderReact18, spec });
      if (disposed) { p.dispose(); return; }
      plugin = p;
      pluginRef.current = p;

      try {
        const res = await fetch(`https://alphafold.ebi.ac.uk/api/prediction/${uniprotId}`);
        if (!res.ok) throw new Error(`AlphaFold API ${res.status}`);
        const [entry] = await res.json();
        console.log("AF entry:", entry);

        console.log("1 downloading", entry.pdbUrl);
        const data = await p.builders.data.download(
          { url: entry.pdbUrl, isBinary: false },
          { state: { isGhost: false } }
        );
        console.log("2 downloaded", data);
        const traj = await p.builders.structure.parseTrajectory(data, 'pdb');
        console.log("3 parsed");
        try {
          await p.builders.structure.hierarchy.applyPreset(traj, 'default');
        } catch (e) {
          console.warn("pLDDT preset failed, using default:", e);
          await p.builders.structure.hierarchy.applyPreset(traj, 'default');
        }
        if (disposed) return;

        sub = p.behaviors.interaction.click.subscribe((e) => {
          const loci = e.current.loci;
          if (StructureElement.Loci.is(loci) && !StructureElement.Loci.isEmpty(loci)) {
            const loc = StructureElement.Location.create(loci.structure);
            StructureElement.Loci.getFirstLocation(loci, loc);
            setSelectedPosition(StructureProperties.residue.label_seq_id(loc));
          }
        });
        console.log("4 preset ok");
        p.managers.camera.reset();

        setReady(true);
      } catch (err) {
        console.error("AlphaFold structure not available:", err);
      }
    })();

    return () => {
      disposed = true;
      setReady(false);
      sub?.unsubscribe();
      siteRefs.current = [];
      pluginRef.current = null;
      plugin?.dispose();
      target.remove();
    };
  }, [uniprotId, setSelectedPosition]);

  // ---- draw PTM sites (all, no filter) ----
  useEffect(() => {
    const p = pluginRef.current;
    if (!ready || !p) return;
    const structure = p.managers.structure.hierarchy.current.structures[0];
    if (!structure) return;

    (async () => {
      try {
        if (siteRefs.current.length) {
          const b = p.build();
          siteRefs.current.forEach((r) => b.delete(r));
          await b.commit();
          siteRefs.current = [];
        }

        const groups = new Map<string, Set<number>>();
        (sites || []).forEach((s) => {
          if (!Number.isInteger(s?.position)) return;
          const key = s.ptm?.ptm_type || 'Other';
          if (!groups.has(key)) groups.set(key, new Set());
          groups.get(key)!.add(s.position);
        });

        for (const [type, set] of groups) {
          const comp = await p.builders.structure.tryCreateComponentFromExpression(
            structure.cell,
            residueExpr([...set]),
            `ptm-${type}`,
            { label: type }
          );
          if (!comp) continue;
          await p.builders.structure.representation.addRepresentation(comp, {
            type: 'ball-and-stick',
            color: 'uniform',
            colorParams: { value: Color(PTM_COLORS[type] ?? DEFAULT_COLOR) },
          });
          siteRefs.current.push(comp.ref);
        }
      } catch (err) {
        console.error("PTM site drawing failed:", err);
      }
    })();
  }, [ready, sites]);

  // ---- table/sequence -> 3D focus ----
  useEffect(() => {
    const p = pluginRef.current;
    if (!ready || !p) return;
    try {
      const structure = p.managers.structure.hierarchy.current.structures[0];
      const data = structure?.cell.obj?.data;
      if (!data) return;

      p.managers.interactivity.lociSelects.deselectAll();
      if (selectedPosition == null) return;

      const sel = Script.getStructureSelection(residueExpr([selectedPosition]), data);
      const loci = StructureSelection.toLociWithSourceUnits(sel);
      if (StructureElement.Loci.isEmpty(loci)) return;
      p.managers.interactivity.lociSelects.select({ loci });
      p.managers.camera.focusLoci(loci);
    } catch (err) {
      console.error("Focus failed:", err);
    }
  }, [ready, selectedPosition]);

  return <div ref={hostRef} className="w-full h-full relative rounded-lg" />;
}