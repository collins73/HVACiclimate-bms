import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { Building2, Layers, AlertTriangle, Plus, ChevronLeft, Thermometer, Pencil, Map, Calculator, Box } from 'lucide-react';
import BlueprintPinEditor from '@/components/buildings/BlueprintPinEditor';
import LoadEstimator from '@/components/buildings/LoadEstimator';
import FloorPlan3DViewer from '@/components/buildings/FloorPlan3DViewer';
import { Button } from '@/components/ui/button';
import PageHeader from '@/components/shared/PageHeader';
import StatusBadge from '@/components/shared/StatusBadge';
import SensorReadout from '@/components/shared/SensorReadout';
import ZoneModal from '@/components/zones/ZoneModal';
import BuildingModal from '@/components/buildings/BuildingModal';

export default function BuildingDetail() {
  const { id } = useParams();
  const [building, setBuilding] = useState(null);
  const [zones, setZones] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [readings, setReadings] = useState([]);
  const [zoneModal, setZoneModal] = useState(false);
  const [editModal, setEditModal] = useState(false);
  const [buildings, setBuildings] = useState([]);
  const [tab, setTab] = useState('zones'); // zones | blueprints | 3d | loads
  const [sensorPins, setSensorPins] = useState([]);

  const load = async () => {
    try {
      const [b, allBuildings, z, a, r, bps, pins] = await Promise.all([
        base44.entities.Building.filter({ id }),
        base44.entities.Building.list(),
        base44.entities.Zone.filter({ building_id: id }),
        base44.entities.Alert.filter({ building_id: id }),
        base44.entities.EnvironmentReading.list('-timestamp', 100),
        base44.entities.Blueprint.filter({ building_id: id }),
        base44.entities.SensorPin.filter({ building_id: id }),
      ]);
      setSensorPins(pins);
      const buildingRecord = b[0];
      // Merge inline blueprints with Blueprint entity records (normalize to {name, url, floor})
      const inlineUrls = new Set((buildingRecord?.blueprints || []).map(bp => bp.url));
      const entityBps = bps
        .filter(bp => !inlineUrls.has(bp.file_url))
        .map(bp => ({ name: bp.name, url: bp.file_url, floor: bp.floor }));
      const mergedBlueprints = [...(buildingRecord?.blueprints || []), ...entityBps];
      setBuilding({ ...buildingRecord, blueprints: mergedBlueprints });
      setBuildings(allBuildings);
      setZones(z);
      setAlerts(a);
      setReadings(r.filter(r => r.building_id === id));
    } catch (error) {
      console.error('Failed to load building data:', error);
      setBuilding(null);
    }
  };

  useEffect(() => { load(); }, [id]);

  if (!building) return <div className="p-6 text-muted-foreground">Loading…</div>;

  const openAlerts = alerts.filter(a => a.status === 'Open');

  const latestByZone = {};
  readings.forEach(r => {
    if (!latestByZone[r.zone_id] || r.timestamp > latestByZone[r.zone_id].timestamp) {
      latestByZone[r.zone_id] = r;
    }
  });

  // Group zones by floor
  const byFloor = {};
  zones.forEach(z => {
    const f = z.floor || 0;
    if (!byFloor[f]) byFloor[f] = [];
    byFloor[f].push(z);
  });
  const floors = Object.keys(byFloor).sort((a, b) => Number(b) - Number(a));

  return (
    <div className="p-6 space-y-6">
      {/* Back */}
      <Link to="/buildings" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
        <ChevronLeft className="w-4 h-4" /> Buildings
      </Link>

      <PageHeader
        title={building.name}
        subtitle={[building.address, building.city, building.state].filter(Boolean).join(', ') || 'No address'}
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setEditModal(true)} className="border-border text-muted-foreground hover:text-foreground gap-2">
              <Pencil className="w-4 h-4" /> Edit
            </Button>
            <Button onClick={() => setZoneModal(true)} className="bg-primary text-primary-foreground hover:bg-primary/90 gap-2">
              <Plus className="w-4 h-4" /> Add Zone
            </Button>
          </div>
        }
      />

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-card border border-border rounded-xl p-4 text-center">
          <StatusBadge status={building.status} size="md" />
          <div className="text-xs text-muted-foreground mt-2">Status</div>
        </div>
        <div className="bg-card border border-border rounded-xl p-4 text-center">
          <div className="text-2xl font-bold text-foreground font-mono">{building.floors || '--'}</div>
          <div className="text-xs text-muted-foreground mt-1">Floors</div>
        </div>
        <div className="bg-card border border-border rounded-xl p-4 text-center">
          <div className="text-2xl font-bold text-cyan-400 font-mono">{zones.length}</div>
          <div className="text-xs text-muted-foreground mt-1">Zones</div>
        </div>
        <div className="bg-card border border-border rounded-xl p-4 text-center">
          <div className={`text-2xl font-bold font-mono ${openAlerts.length > 0 ? 'text-red-400' : 'text-emerald-400'}`}>{openAlerts.length}</div>
          <div className="text-xs text-muted-foreground mt-1">Open Alerts</div>
        </div>
      </div>

      {/* Tab nav */}
      <div className="flex gap-1 bg-card border border-border rounded-xl p-1 w-fit">
        {[
          { id: 'zones', label: 'Zones', icon: Layers },
          { id: 'blueprints', label: 'Blueprints', icon: Map },
          { id: '3d', label: '3D Model', icon: Box },
          { id: 'loads', label: 'Load Estimator', icon: Calculator },
        ].map(t => {
          const Icon = t.icon;
          return (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-all ${tab === t.id ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground'}`}>
              <Icon className="w-3.5 h-3.5" />{t.label}
            </button>
          );
        })}
      </div>

      {/* Zones by Floor */}
      {tab === 'zones' && floors.length === 0 ? (
        <div className="bg-card border border-border rounded-xl p-10 text-center text-muted-foreground">
          <Layers className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p>No zones added yet</p>
          <Button onClick={() => setZoneModal(true)} className="mt-4 bg-primary text-primary-foreground gap-2">
            <Plus className="w-4 h-4" /> Add First Zone
          </Button>
        </div>
      ) : tab === 'zones' && floors.map(floor => (
        <div key={floor}>
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
            {Number(floor) === 0 ? 'Ground Floor / Unassigned' : `Floor ${floor}`}
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {byFloor[floor].map(z => {
              const reading = latestByZone[z.id];
              const zoneAlerts = openAlerts.filter(a => a.zone_id === z.id);
              return (
                <div key={z.id} className="bg-card border border-border rounded-xl p-4 hover:border-primary/30 transition-all">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <div className="font-semibold text-foreground">{z.name}</div>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-xs text-muted-foreground bg-muted rounded px-1.5 py-0.5">{z.zone_type}</span>
                        <StatusBadge status={z.status} />
                      </div>
                    </div>
                    {zoneAlerts.length > 0 && (
                      <div className="flex items-center gap-1 bg-red-500/10 border border-red-500/20 rounded-lg px-2 py-1">
                        <AlertTriangle className="w-3 h-3 text-red-400" />
                        <span className="text-xs text-red-400 font-medium">{zoneAlerts.length}</span>
                      </div>
                    )}
                  </div>
                  <SensorReadout temperature={reading?.temperature} humidity={reading?.humidity} co2_ppm={reading?.co2_ppm} compact />
                  <Link to={`/zones/${z.id}`} className="mt-3 flex items-center justify-center gap-2 w-full py-2 rounded-lg bg-primary/10 border border-primary/20 text-primary text-xs font-medium hover:bg-primary/20 transition-colors">
                    <Thermometer className="w-3.5 h-3.5" /> Zone Control
                  </Link>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {/* Blueprints */}
      {tab === 'blueprints' && (
        <BlueprintPinEditor building={building} zones={zones} blueprints={building.blueprints} />
      )}

      {/* 3D Model */}
      {tab === '3d' && (
        <FloorPlan3DViewer
          building={building}
          zones={zones}
          blueprints={building.blueprints}
          sensorPins={sensorPins}
        />
      )}

      {/* Load Estimator */}
      {tab === 'loads' && (
        <LoadEstimator building={building} />
      )}

      <ZoneModal open={zoneModal} onClose={() => setZoneModal(false)} buildings={buildings} defaultBuildingId={id} onSaved={load} />
      <BuildingModal open={editModal} onClose={() => setEditModal(false)} building={building} onSaved={load} />
    </div>
  );
}