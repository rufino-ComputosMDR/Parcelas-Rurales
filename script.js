// ==========================================================================
// CORRECCIÓN AUTOMÁTICA PARA ADVERTENCIAS DE FIREFOX (mozPressure / mozInputSource)
// ==========================================================================
if (typeof MouseEvent !== 'undefined') {
    if (!Object.getOwnPropertyDescriptor(MouseEvent.prototype, 'mozPressure')) {
        Object.defineProperty(MouseEvent.prototype, 'mozPressure', {
            get: function() { return this.pressure !== undefined ? this.pressure : 0; },
            configurable: true
        });
    }
    if (!Object.getOwnPropertyDescriptor(MouseEvent.prototype, 'mozInputSource')) {
        Object.defineProperty(MouseEvent.prototype, 'mozInputSource', {
            get: function() {
                if (this.pointerType === 'pen') return 2;
                if (this.pointerType === 'touch') return 3;
                return 1;
            },
            configurable: true
        });
    }
}

// ==========================================================================
// INICIALIZACIÓN DEL MAPA Y VARIABLES GLOBALES
// ==========================================================================
const map = L.map('map').setView([-34.15, -62.6], 10);
let capaZonas, capaParcelas, capaReferencias, marcadorCoordenada;
let capaSegmentosMedidos = L.featureGroup(); 
let datosRuralesGlobal = null; 
let datosReferenciasGlobal = null; 
let referenciasVisibles = false;
let graficoVisible = false;
let topDeudoresVisible = false;
let capaCaminosRurales = null;

// Variables para menú de caminos rurales y reportes
let listaCaminosGlobal = [];
let capaCaminoResaltado = null;
let capaParcelasCamino = null;
let panelCaminosVisible = false;
let parcelasCaminoActual = [];
let caminoActualSeleccionado = null;

// Capas base: OpenStreetMap y Satelital (Esri)
let capaOSM = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap'
}).addTo(map);

let capaSatelital = L.layerGroup([
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        attribution: 'Tiles &copy; Esri'
    }),
    L.tileLayer('https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}'),
    L.tileLayer('https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}')
]);

let satelitalActiva = false;

function toggleImagenSatelital() {
    const btn = document.getElementById('btn-satelital');
    if (satelitalActiva) {
        map.removeLayer(capaSatelital);
        capaOSM.addTo(map);
        if (btn) btn.classList.remove('activo');
    } else {
        map.removeLayer(capaOSM);
        capaSatelital.addTo(map);
        if (btn) btn.classList.add('activo');
    }
    satelitalActiva = !satelitalActiva;
}

const colores = ['#e6194b', '#3cb44b', '#ffe119', '#4363d8', '#f58231', '#911eb4'];

function limpiarMonto(texto) {
    if (texto === null || texto === undefined) return 0;
    if (typeof texto === 'number') return texto;
    let str = texto.toString().trim();
    if (!str) return 0;
    
    str = str.replace(/\$/g, '').replace(/\s+/g, '');
    
    const tieneComa = str.includes(',');
    const tienePunto = str.includes('.');

    if (tieneComa && tienePunto) {
        const posComa = str.lastIndexOf(',');
        const posPunto = str.lastIndexOf('.');

        if (posPunto > posComa) {
            str = str.replace(/,/g, '');
        } else {
            str = str.replace(/\./g, '').replace(',', '.');
        }
    } else if (tieneComa && !tienePunto) {
        str = str.replace(',', '.');
    } else if (tienePunto && !tieneComa) {
        const partes = str.split('.');
        const ultimaParte = partes[partes.length - 1];
        
        if (partes.length > 2 || ultimaParte.length > 2) {
            str = str.replace(/\./g, '');
        }
    }

    let resultadoFlotante = parseFloat(str);
    return isNaN(resultadoFlotante) ? 0 : resultadoFlotante;
}

function formatearMoneda(valor) {
    let numero = limpiarMonto(valor);
    return "$ " + numero.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function obtenerFechaDeuda() {
    if (!datosRuralesGlobal || !datosRuralesGlobal.features || datosRuralesGlobal.features.length === 0) {
        return "";
    }
    for (let f of datosRuralesGlobal.features) {
        if (f.properties) {
            let keyFecha = Object.keys(f.properties).find(k => k.toLowerCase().includes("deuda a la fecha"));
            if (keyFecha && f.properties[keyFecha]) {
                return f.properties[keyFecha].toString().trim();
            }
        }
    }
    return "";
}

// CÁLCULO MÉTRICO DE LONGITUD DE CAMINOS RURALES
function calcularLongitudFeature(feature) {
    let totalMetros = 0;
    let coords = feature.geometry.coordinates;
    
    function distanciaEntrePuntos(c1, c2) {
        let p1 = L.latLng(c1[1], c1[0]);
        let p2 = L.latLng(c2[1], c2[0]);
        return p1.distanceTo(p2);
    }

    if (feature.geometry.type === 'LineString') {
        for (let i = 0; i < coords.length - 1; i++) {
            totalMetros += distanciaEntrePuntos(coords[i], coords[i+1]);
        }
    } else if (feature.geometry.type === 'MultiLineString') {
        coords.forEach(linea => {
            for (let i = 0; i < linea.length - 1; i++) {
                totalMetros += distanciaEntrePuntos(linea[i], linea[i+1]);
            }
        });
    }
    return totalMetros;
}

function formatearLongitud(metros) {
    if (metros >= 1000) {
        return (metros / 1000).toFixed(2) + " km";
    }
    return Math.round(metros) + " m";
}

// DETECCION DINÁMICA DEL NOMBRE DEL CAMINO
function obtenerNombreCamino(feature, indice) {
    if (!feature || !feature.properties) return `Camino Rural ${indice + 1}`;
    const p = feature.properties;
    
    for (let key of Object.keys(p)) {
        let kLow = key.toLowerCase();
        if (kLow === 'name' || kLow === 'nombre' || kLow === 'camino' || kLow === 'ref' || kLow === 'etiqueta' || kLow.includes('nombre') || kLow.includes('camino')) {
            if (p[key] && p[key].toString().trim() !== "") {
                return p[key].toString().trim();
            }
        }
    }
    for (let key of Object.keys(p)) {
        if (p[key] && typeof p[key] === 'string' && p[key].trim() !== "") {
            return p[key].trim();
        }
    }
    return `Camino Rural ${indice + 1}`;
}

// ==========================================================================
// 1. CARGA DE ARCHIVOS GEOJSON
// ==========================================================================
fetch('zonas.geojson')
    .then(res => res.json())
    .then(data => {
        capaZonas = L.geoJSON(data, {
            style: (feature) => ({
                fillColor: colores[feature.properties.id % colores.length],
                weight: 2,
                color: 'white',
                fillOpacity: 0.5
            }),
            onEachFeature: (feature, layer) => {
                layer.bindTooltip("Hoja " + feature.properties.id, {
                    permanent: true,
                    direction: 'center',
                    className: 'etiqueta-zona'
                });
                layer.on('click', function(e) {
                    comenzarAuditoriaZona(feature.properties.id, e.target.getBounds());
                });
            }
        }).addTo(map);
        map.fitBounds(capaZonas.getBounds());
        prepararCapasAuxiliares();
    })
    .catch(err => console.error("Error zonas:", err));

fetch('rurales.geojson')
    .then(res => res.json())
    .then(data => { 
        datosRuralesGlobal = data; 
        configurarLanzadorAutomaticoDatalist();
    })
    .catch(err => console.error("Error rurales:", err));

function comenzarAuditoriaZona(idHoja, bounds) {
    if (map.hasLayer(capaZonas)) {
        map.removeLayer(capaZonas); 
    }
    const idHojaNumerico = parseInt(idHoja, 10);
    cargarParcelas(idHojaNumerico, bounds);

    generarGraficoBarrasDinamicas(idHojaNumerico);
    const modal = document.getElementById('modal-grafico-barras');
    const btn = document.getElementById('btn-grafico');
    if (modal && btn) {
        modal.style.display = 'block';
        btn.classList.add('activo');
        graficoVisible = true;
    }
}

// ==========================================================================
// 2. REFERENCIAS Y CAMINOS RURALES (LECTURA DESDE caminos.geojson)
// ==========================================================================
function prepararCapasAuxiliares() {
    fetch('referencias.geojson')
        .then(res => res.json())
        .then(data => {
            datosReferenciasGlobal = data; 
            capaReferencias = L.geoJSON(data, {
                filter: function(feature) {
                    return feature.geometry && feature.geometry.type === 'Point';
                },
                pointToLayer: function (feature, latlng) {
                    let p = feature.properties;
                    let nombreVisible = p.Name || p.nombre || p.NOMBRE || "Punto sin nombre";
                    let textoIcono = L.divIcon({
                        className: 'texto-referencia-mapa',
                        html: `<div>📍 ${nombreVisible}</div>`,
                        iconSize: null 
                    });
                    return L.marker(latlng, { icon: textoIcono });
                }
            });
        })
        .catch(err => console.error("Error referencias:", err));

    fetch('caminos.geojson')
        .then(res => res.json())
        .then(data => {
            listaCaminosGlobal = [];
            let contadorCamino = 0;

            capaCaminosRurales = L.geoJSON(data, {
                filter: function(feature) {
                    let esCamino = feature.geometry && 
                          (feature.geometry.type === 'LineString' || feature.geometry.type === 'MultiLineString');
                    
                    if (esCamino) {
                        let nombreCamino = obtenerNombreCamino(feature, contadorCamino);
                        let longitud = calcularLongitudFeature(feature);
                        
                        feature._nombreCalculado = nombreCamino;

                        listaCaminosGlobal.push({
                            id: "camino_id_" + contadorCamino++,
                            nombre: nombreCamino,
                            feature: feature,
                            longitud: longitud
                        });
                    }
                    return esCamino;
                },
                style: function(feature) {
                    return {
                        color: '#e67e22',
                        weight: 4,
                        opacity: 0.85,
                        dashArray: '6, 6'
                    };
                },
                onEachFeature: function(feature, layer) {
                    let nombreCamino = feature._nombreCalculado || obtenerNombreCamino(feature, 0);
                    let longitud = calcularLongitudFeature(feature);
                    let textoLongitud = formatearLongitud(longitud);

                    layer.bindTooltip(`
                        <div style="font-weight: 700; font-size: 12px; color: #0f172a;">${nombreCamino}</div>
                        <div style="font-size: 11px; color: #0284c7; font-weight: 600; margin-top: 2px;">📏 Longitud: ${textoLongitud}</div>
                    `, {
                        sticky: true,
                        className: 'burbuja-camino-burbuja'
                    });
                }
            }).addTo(map);

            poblarDesplegableCaminos();
        })
        .catch(err => console.error("Error cargando caminos.geojson:", err));
}

function toggleReferencias() {
    if (!capaReferencias && !capaCaminosRurales) return;
    if (referenciasVisibles) {
        if (capaReferencias) map.removeLayer(capaReferencias);
        if (capaCaminosRurales) map.removeLayer(capaCaminosRurales);
        document.getElementById('btn-referencias').innerText = "📍 Mostrar Referencias";
        document.getElementById('btn-referencias').classList.remove('activo');
    } else {
        if (capaReferencias) capaReferencias.addTo(map);
        if (capaCaminosRurales) capaCaminosRurales.addTo(map);
        document.getElementById('btn-referencias').innerText = "📍 Ocultar Referencias";
        document.getElementById('btn-referencias').classList.add('activo');
    }
    referenciasVisibles = !referenciasVisibles;
}

// 2.1 MENÚ DESPLEGABLE Y AUDITORÍA DE CAMINOS
function togglePanelCaminos() {
    const panel = document.getElementById('panel-caminos-rurales');
    const btn = document.getElementById('btn-caminos');
    if (!panel || !btn) return;

    if (panelCaminosVisible) {
        panel.style.display = 'none';
        btn.classList.remove('activo');
    } else {
        panel.style.display = 'flex';
        btn.classList.add('activo');
    }
    panelCaminosVisible = !panelCaminosVisible;
}

function poblarDesplegableCaminos() {
    const select = document.getElementById('select-camino-rural');
    if (!select) return;
    select.innerHTML = `<option value="">-- Seleccionar Camino Exacto --</option>`;

    listaCaminosGlobal.sort((a, b) => a.nombre.localeCompare(b.nombre, undefined, { numeric: true, sensitivity: 'base' }));

    listaCaminosGlobal.forEach(c => {
        let opt = document.createElement('option');
        opt.value = c.id; 
        opt.textContent = `${c.nombre} (${formatearLongitud(c.longitud)})`;
        select.appendChild(opt);
    });
}

function distanciaPuntoASegmento(p, a, b) {
    const cosLat = Math.cos(p.lat * Math.PI / 180);
    const x = (p.lng - a.lng) * 111320 * cosLat;
    const y = (p.lat - a.lat) * 111320;
    const x2 = (b.lng - a.lng) * 111320 * cosLat;
    const y2 = (b.lat - a.lat) * 111320;

    const l2 = x2 * x2 + y2 * y2;
    if (l2 === 0) return Math.hypot(x, y);

    let t = (x * x2 + y * y2) / l2;
    t = Math.max(0, Math.min(1, t));

    const projX = t * x2;
    const projY = t * y2;

    return Math.hypot(x - projX, y - projY);
}

// BÚSQUEDA OPTIMIZADA DE PARCELAS A AMBOS LADOS DEL CAMINO
function obtenerParcelasEnCamino(caminoObj, umbralMetros = 150) {
    if (!datosRuralesGlobal || !datosRuralesGlobal.features) return [];
    
    let segmentos = [];
    let geom = caminoObj.feature.geometry;
    let lineas = geom.type === 'LineString' ? [geom.coordinates] : geom.coordinates;
    
    lineas.forEach(coords => {
        for (let i = 0; i < coords.length - 1; i++) {
            segmentos.push({
                a: L.latLng(coords[i][1], coords[i][0]),
                b: L.latLng(coords[i+1][1], coords[i+1][0])
            });
        }
    });

    let parcelasEncontradas = [];

    datosRuralesGlobal.features.forEach(fParcela => {
        if (!fParcela.geometry || !fParcela.geometry.coordinates) return;
        
        let coords = fParcela.geometry.coordinates;
        let type = fParcela.geometry.type;
        let puntosAProbar = [];

        if (type === 'Polygon') {
            let sumLat = 0, sumLng = 0, count = 0;
            coords[0].forEach(c => {
                puntosAProbar.push(L.latLng(c[1], c[0]));
                sumLat += c[1];
                sumLng += c[0];
                count++;
            });
            if (count > 0) puntosAProbar.push(L.latLng(sumLat / count, sumLng / count));
        } else if (type === 'MultiPolygon') {
            coords.forEach(poly => {
                let sumLat = 0, sumLng = 0, count = 0;
                poly[0].forEach(c => {
                    puntosAProbar.push(L.latLng(c[1], c[0]));
                    sumLat += c[1];
                    sumLng += c[0];
                    count++;
                });
                if (count > 0) puntosAProbar.push(L.latLng(sumLat / count, sumLng / count));
            });
        }

        let estaCerca = false;
        for (let pt of puntosAProbar) {
            for (let seg of segmentos) {
                let dist = distanciaPuntoASegmento(pt, seg.a, seg.b);
                if (dist <= umbralMetros) {
                    estaCerca = true;
                    break;
                }
            }
            if (estaCerca) break;
        }

        if (estaCerca) {
            parcelasEncontradas.push(fParcela);
        }
    });

    return parcelasEncontradas;
}

function seleccionarCaminoExacto(idCamino) {
    if (!idCamino) {
        limpiarSeleccionCamino();
        return;
    }

    const caminoObj = listaCaminosGlobal.find(c => c.id === idCamino);
    if (!caminoObj) return;

    caminoActualSeleccionado = caminoObj;

    if (capaCaminoResaltado) map.removeLayer(capaCaminoResaltado);
    if (capaParcelasCamino) map.removeLayer(capaParcelasCamino);
    if (capaParcelas) map.removeLayer(capaParcelas);
    capaSegmentosMedidos.clearLayers();

    const parcelasAbarcadas = obtenerParcelasEnCamino(caminoObj);
    parcelasCaminoActual = parcelasAbarcadas;

    // DIBUJA LAS PARCELAS DE AMBOS LADOS EN EL MAPA CON SEMÁFORO FISCAL
    capaParcelasCamino = L.geoJSON({ type: "FeatureCollection", features: parcelasAbarcadas }, {
        style: (feature) => {
            const p = feature.properties;
            let keyPeriodos = Object.keys(p).find(k => k.toLowerCase().includes("periodos")) || "Periodos Deuda";
            let periodos = parseInt(p[keyPeriodos], 10) || 0;
            
            let colorSemaforo = '#2ecc71'; 
            if (periodos >= 2 && periodos <= 3) { 
                colorSemaforo = '#f1c40f'; 
            } else if (periodos >= 4) { 
                colorSemaforo = '#e74c3c'; 
            }

            return { 
                color: '#1e293b', 
                weight: 1.5, 
                fillColor: colorSemaforo, 
                fillOpacity: 0.75 
            };
        },
        onEachFeature: (feature, layer) => {
            const p = feature.properties;
            if (p.TGIRural) {
                layer.bindTooltip(p.TGIRural.toString(), { 
                    permanent: true, direction: 'center', className: 'etiqueta-parcela' 
                });
            }

            layer.on('click', function(e) {
                medirLadosDeParcela(feature);

                let tablaHtml = `<table class="ficha-tabla" style="width:100%; border-collapse:collapse;">`;
                for (let key in p) {
                    let keyMinuscula = key.toLowerCase();
                    if (keyMinuscula.startsWith("nomenc")) continue;

                    let valor = p[key];
                    if (keyMinuscula.includes("periodos deuda")) {
                        valor = parseInt(valor, 10) || 0;
                    } else if (keyMinuscula === "total adeudado sin judic." || keyMinuscula.includes("importe") || keyMinuscula.includes("monto")) {
                        valor = formatearMoneda(valor);
                    }
                    tablaHtml += `<tr style="border-bottom:1px solid #e2e8f0;"><td class="label" style="font-weight:bold; color:#64748b; padding:6px 10px 6px 0; font-size:11px;">${key}</td><td style="font-size:11px; color:#0f172a; font-weight: 500; padding:6px 0;">${valor !== null && valor !== undefined ? valor : '-'}</td></tr>`;
                }
                tablaHtml += `</table>`;

                document.getElementById('contenido-tabla-datos').innerHTML = tablaHtml;
                document.getElementById('panel-datos-parcela').style.display = 'flex';
                if (e && e.latlng) L.DomEvent.stopPropagation(e);
            });
        }
    }).addTo(map);

    // RESALTA EL CAMINO POR ENCIMA DE LAS PARCELAS
    capaCaminoResaltado = L.geoJSON(caminoObj.feature, {
        style: {
            color: '#0284c7',
            weight: 6,
            opacity: 0.95
        }
    }).addTo(map);

    if (map.hasLayer(capaZonas)) map.removeLayer(capaZonas);

    const bounds = capaCaminoResaltado.getBounds();
    if (bounds.isValid()) {
        map.fitBounds(bounds, { padding: [40, 40] });
    }

    document.getElementById('lbl-nombre-camino').innerText = caminoObj.nombre;
    document.getElementById('lbl-longitud-camino').innerText = `📏 Longitud Total: ${formatearLongitud(caminoObj.longitud)}`;
    document.getElementById('info-camino-detalle').style.display = 'block';
    
    generarSemaforoCaminoSeleccionado(parcelasAbarcadas);
    document.getElementById('btn-reset').style.display = 'block';
}

function generarSemaforoCaminoSeleccionado(parcelas) {
    let counts = { Verde: 0, Amarillo: 0, Rojo: 0 };
    let totalAdeudadoMonto = 0;
    let total = parcelas.length;

    parcelas.forEach(f => {
        let p = f.properties;
        let keyPeriodos = Object.keys(p).find(k => k.toLowerCase().includes("periodos")) || "Periodos Deuda";
        let periodos = parseInt(p[keyPeriodos], 10) || 0;
        
        let keyMonto = Object.keys(p).find(k => k.toLowerCase().includes("total adeudado") || k.toLowerCase().includes("importe") || k.toLowerCase().includes("monto")) || "Total Adeudado sin judic.";
        let monto = limpiarMonto(p[keyMonto]);

        totalAdeudadoMonto += monto;
        counts[obtenerCategoriaSemaforo(periodos)]++;
    });

    let pctV = total > 0 ? ((counts.Verde / total) * 100).toFixed(1) : 0;
    let pctA = total > 0 ? ((counts.Amarillo / total) * 100).toFixed(1) : 0;
    let pctR = total > 0 ? ((counts.Rojo / total) * 100).toFixed(1) : 0;

    document.getElementById('contenedor-semaforo-camino').innerHTML = `
        <div style="font-weight: 700; font-size: 12px; color: #1e293b; margin-bottom: 6px; text-align: center;">
            📊 Semáforo Fiscal de Ambos Lados (${total} parcelas)
        </div>
        <div class="tarjeta-metrica-global" style="background: #ffffff; padding: 10px; border-radius: 8px; border: 1px solid #e2e8f0;">
            <div class="item-barra-progreso">
                <div class="info-barra"><span>🟢 Al Día</span> <strong>${pctV}% (${counts.Verde})</strong></div>
                <div class="linea-progreso-fondo"><div class="linea-progreso-relleno verde" style="width: ${pctV}%"></div></div>
            </div>
            <div class="item-barra-progreso">
                <div class="info-barra"><span>🟡 Mediana</span> <strong>${pctA}% (${counts.Amarillo})</strong></div>
                <div class="linea-progreso-fondo"><div class="linea-progreso-relleno amarillo" style="width: ${pctA}%"></div></div>
            </div>
            <div class="item-barra-progreso">
                <div class="info-barra"><span>🔴 Deuda</span> <strong>${pctR}% (${counts.Rojo})</strong></div>
                <div class="linea-progreso-fondo"><div class="linea-progreso-relleno rojo" style="width: ${pctR}%"></div></div>
            </div>
            <div style="margin-top: 10px; padding-top: 8px; border-top: 1px solid #cbd5e1; font-size: 11px; text-align: center; font-weight: 700; color: #dc2626;">
                💰 Deuda Total: ${formatearMoneda(totalAdeudadoMonto)}
            </div>
            
            <!-- BOTÓN INFORME PDF (Ubicado justo debajo de la deuda) -->
            <button onclick="generarInformeCaminoPDF()" style="margin-top: 10px; width: 100%; background: #0284c7; color: white; border: none; padding: 8px 12px; border-radius: 6px; font-weight: 700; font-size: 11px; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 6px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); transition: all 0.2s ease;">
                📄 Informe PDF
            </button>
        </div>
    `;
}

// GENERACIÓN DEL REPORTE/INFORME DE PARCELAS DEL CAMINO (FORMATO IGUAL A TOP DEUDORES)
function generarInformeCaminoPDF() {
    if (!parcelasCaminoActual || parcelasCaminoActual.length === 0) {
        alert("No hay parcelas seleccionadas en este camino para generar el informe.");
        return;
    }

    let mapTGI = {};
    let totalAdeudadoCamino = 0;

    parcelasCaminoActual.forEach(f => {
        let p = f.properties;
        let tgiRaw = p["TGIRural"] ? p["TGIRural"].toString().trim() : "S/D";
        
        let keyPeriodos = Object.keys(p).find(k => k.toLowerCase().includes("periodos")) || "Periodos Deuda";
        let periodos = parseInt(p[keyPeriodos], 10) || 0;

        let keyMonto = Object.keys(p).find(k => k.toLowerCase().includes("total adeudado") || k.toLowerCase().includes("importe") || k.toLowerCase().includes("monto")) || "Total Adeudado sin judic.";
        let montoLimpio = limpiarMonto(p[keyMonto]);

        if (!mapTGI[tgiRaw]) {
            mapTGI[tgiRaw] = {
                tgi: tgiRaw,
                titular: p["Tit. Nombre"] || "Sin Titular Registrado",
                periodos: periodos,
                monto: montoLimpio
            };
        } else {
            if (montoLimpio > mapTGI[tgiRaw].monto) mapTGI[tgiRaw].monto = montoLimpio;
            if (periodos > mapTGI[tgiRaw].periodos) mapTGI[tgiRaw].periodos = periodos;
        }
    });

    let listaParcelas = Object.values(mapTGI);
    listaParcelas.sort((a, b) => b.monto - a.monto);

    listaParcelas.forEach(d => totalAdeudadoCamino += d.monto);

    let fechaTexto = obtenerFechaDeuda();
    let badgeFecha = fechaTexto ? `📅 Deuda a la fecha: ${fechaTexto}` : "📅 Deudas a la fecha";
    let columnaMontoTitulo = fechaTexto ? `Deuda Total TGI (al ${fechaTexto})` : "Deuda Total TGI a la Fecha";
    let nombreCamino = caminoActualSeleccionado ? caminoActualSeleccionado.nombre : "Camino Rural";
    let longCamino = caminoActualSeleccionado ? formatearLongitud(caminoActualSeleccionado.longitud) : "";

    let filasHtml = "";
    listaParcelas.forEach((d) => {
        let badgeClass = "badge-rojo";
        if (d.periodos <= 1) badgeClass = "badge-verde";
        else if (d.periodos <= 3) badgeClass = "badge-amarillo";

        filasHtml += `
            <tr onclick="hacerClicFilaTop('${d.tgi}')">
                <td style="padding: 14px 18px;"><span class="celda-tgi-resaltada">${d.tgi}</span></td>
                <td style="padding: 14px 18px; color: #0f172a; font-weight: 600; text-transform: uppercase; font-size: 12px;">${d.titular}</td>
                <td style="text-align: center; padding: 14px 18px;"><span class="badge-periodos ${badgeClass}">${d.periodos} Períodos</span></td>
                <td style="text-align: right; font-weight: 800; color: #dc2626; font-size: 14px; padding: 14px 18px; font-family: 'Courier New', Courier, monospace;">${formatearMoneda(d.monto)}</td>
            </tr>
        `;
    });

    const vistaCompleta = document.getElementById('pantalla-completa-top');
    const contenedorTabla = document.getElementById('contenedor-tabla-grande-top');

    contenedorTabla.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; flex-wrap: wrap; gap: 10px;">
            <div>
                <h2 style="margin: 0; color: #0f172a; font-size: 20px;">🛣️ Informe Catastral: ${nombreCamino}</h2>
                <span style="font-size: 13px; color: #64748b;">Longitud total trazada: <strong>${longCamino}</strong> | Lotes Linderos: <strong>${listaParcelas.length}</strong></span>
            </div>
            <div style="display: flex; gap: 10px; align-items: center;">
                <span style="font-weight: 700; color: #0284c7; background-color: #e0f2fe; padding: 6px 12px; border-radius: 6px; font-size: 12px;">${badgeFecha}</span>
                <button onclick="window.print()" style="background-color: #0284c7; color: white; border: none; padding: 8px 16px; border-radius: 6px; font-weight: 700; cursor: pointer; font-size: 12px; display: flex; align-items: center; gap: 6px;">
                    🖨️ Imprimir / Guardar PDF
                </button>
            </div>
        </div>
        <table class="gran-tabla-reporte">
            <thead>
                <tr>
                    <th style="padding: 14px 18px; text-align: left;">Identificador TGI</th>
                    <th style="padding: 14px 18px; text-align: left;">Contribuyente / Titular Registral</th>
                    <th style="padding: 14px 18px; text-align: center; width: 200px;">Periodos Adeudados</th>
                    <th style="padding: 14px 18px; text-align: right; width: 260px;">${columnaMontoTitulo}</th>
                </tr>
            </thead>
            <tbody>
                ${filasHtml}
            </tbody>
            <tfoot>
                <tr style="background: #f8fafc; font-weight: bold;">
                    <td colspan="3" style="padding: 14px 18px; text-align: right; font-size: 13px; color: #1e293b;">DEUDA TOTAL ACUMULADA DEL CAMINO:</td>
                    <td style="padding: 14px 18px; text-align: right; color: #dc2626; font-size: 15px; font-family: 'Courier New', Courier, monospace;">${formatearMoneda(totalAdeudadoCamino)}</td>
                </tr>
            </tfoot>
        </table>
    `;

    vistaCompleta.style.display = 'block';
    topDeudoresVisible = true;
}

function limpiarSeleccionCamino() {
    if (capaCaminoResaltado) map.removeLayer(capaCaminoResaltado);
    if (capaParcelasCamino) map.removeLayer(capaParcelasCamino);
    document.getElementById('select-camino-rural').value = "";
    document.getElementById('info-camino-detalle').style.display = 'none';
    parcelasCaminoActual = [];
    caminoActualSeleccionado = null;
}

function obtenerRumbo(pt1, pt2) {
    let dLng = (pt2.lng - pt1.lng) * Math.cos(Math.PI / 180 * pt1.lat);
    let dLat = pt2.lat - pt1.lat;
    let angle = Math.atan2(dLng, dLat) * 180 / Math.PI;
    return (angle + 360) % 360;
}

function medirLadosDeParcela(feature) {
    capaSegmentosMedidos.clearLayers(); 
    if (!feature.geometry || (feature.geometry.type !== 'Polygon' && feature.geometry.type !== 'MultiPolygon')) return;
    const poligonos = feature.geometry.type === 'Polygon' ? [feature.geometry.coordinates] : feature.geometry.coordinates;

    poligonos.forEach(anilloExterior => {
        const coordenadas = feature.geometry.type === 'Polygon' ? anilloExterior : anilloExterior[0];
        if (coordenadas.length < 3) return;

        let verticesSimplificados = [];
        let puntosOriginales = coordenadas.map(c => L.latLng(c[1], c[0]));
        let pActual = puntosOriginales[0];
        verticesSimplificados.push(pActual);

        for (let i = 1; i < puntosOriginales.length; i++) {
            let pSiguiente = puntosOriginales[i];
            if (i === puntosOriginales.length - 1) break;

            let rumboCorteActual = obtenerRumbo(pActual, pSiguiente);
            let pFuturo = puntosOriginales[i + 1];
            let rumboCorteSiguiente = obtenerRumbo(pSiguiente, pFuturo);

            let diferenciaAngulo = Math.abs(rumboCorteActual - rumboCorteSiguiente);
            if (diferenciaAngulo > 180) diferenciaAngulo = 360 - diferenciaAngulo;

            if (diferenciaAngulo > 6) {
                verticesSimplificados.push(pSiguiente);
                pActual = pSiguiente;
            }
        }
        verticesSimplificados.push(puntosOriginales[puntosOriginales.length - 1]);

        for (let j = 0; j < verticesSimplificados.length - 1; j++) {
            let esquina1 = verticesSimplificados[j];
            let esquina2 = verticesSimplificados[j + 1];

            let distanciaLadoCompleto = esquina1.distanceTo(esquina2);
            if (distanciaLadoCompleto < 3) continue;

            let lineaLado = L.polyline([esquina1, esquina2], { color: '#2980b9', weight: 4, opacity: 0.85 });
            lineaLado.bindTooltip(`${distanciaLadoCompleto.toFixed(1)} m`, {
                permanent: true, direction: 'center', className: 'etiqueta-medida-segmento'
            });
            capaSegmentosMedidos.addLayer(lineaLado);
        }
    });
    capaSegmentosMedidos.addTo(map);
}

// ==========================================================================
// 3. CAPA PARCELAS Y SEMÁFORO FISCAL
// ==========================================================================
function cargarParcelas(idHoja, bounds, valorBuscadoOriginal = null) {
    if (capaParcelas) map.removeLayer(capaParcelas);
    capaSegmentosMedidos.clearLayers(); 
    renderizarCapaParcelas(idHoja, bounds, valorBuscadoOriginal);
}

function renderizarCapaParcelas(idHoja, bounds, valorBuscadoOriginal) {
    let unLoteYaAbrioFicha = false; 

    capaParcelas = L.geoJSON(datosRuralesGlobal, {
        filter: (feature) => {
            if (!feature.properties || !feature.properties.Hoja) return false;
            if (!feature.geometry || !feature.geometry.coordinates || feature.geometry.coordinates.length === 0) return false;
            return parseInt(feature.properties.Hoja, 10) === parseInt(idHoja, 10);
        },
        style: (feature) => {
            const p = feature.properties;
            
            let coincideBusqueda = false;
            if (valorBuscadoOriginal) {
                const v = valorBuscadoOriginal.toLowerCase();
                const partida = p["PARTIDA"] ? p["PARTIDA"].toString().toLowerCase() : "";
                const tgi = p["TGIRural"] ? p["TGIRural"].toString().toLowerCase() : "";
                const titular = p["Tit. Nombre"] ? p["Tit. Nombre"].toString().toLowerCase() : "";
                if (partida === v || tgi === v || titular === v || titular.includes(v)) {
                    coincideBusqueda = true;
                }
            }

            if (coincideBusqueda) {
                return { color: '#002855', weight: 4, fillColor: '#00b4d8', fillOpacity: 0.85 };
            }

            let keyPeriodos = Object.keys(p).find(k => k.toLowerCase().includes("periodos")) || "Periodos Deuda";
            let periodos = parseInt(p[keyPeriodos], 10) || 0;
            
            let colorSemaforo = '#2ecc71'; 

            if (periodos >= 2 && periodos <= 3) { 
                colorSemaforo = '#f1c40f'; 
            } else if (periodos >= 4) { 
                colorSemaforo = '#e74c3c'; 
            }

            return { 
                color: '#334155', 
                weight: 1.2, 
                fillColor: colorSemaforo, 
                fillOpacity: 0.65 
            };
        },
        onEachFeature: (feature, layer) => {
            const p = feature.properties;
            if (p.TGIRural && typeof layer.getBounds === 'function') {
                try {
                    const boundsLayer = layer.getBounds();
                    if (boundsLayer.isValid()) {
                        layer.bindTooltip(p.TGIRural.toString(), { 
                            permanent: true, direction: 'center', className: 'etiqueta-parcela' 
                        });
                    }
                } catch (e) {}
            }

            layer.on('click', function(e) {
                medirLadosDeParcela(feature);

                let tablaHtml = `<table class="ficha-tabla" style="width:100%; border-collapse:collapse;">`;
                for (let key in p) {
                    let keyMinuscula = key.toLowerCase();
                    if (keyMinuscula.startsWith("nomenc")) continue;

                    let valor = p[key];
                    if (keyMinuscula.includes("periodos deuda")) {
                        valor = parseInt(valor, 10) || 0;
                    } else if (keyMinuscula === "total adeudado sin judic." || keyMinuscula.includes("importe") || keyMinuscula.includes("monto")) {
                        valor = formatearMoneda(valor);
                    }
                    tablaHtml += `<tr style="border-bottom:1px solid #e2e8f0;"><td class="label" style="font-weight:bold; color:#64748b; padding:6px 10px 6px 0; font-size:11px;">${key}</td><td style="font-size:11px; color:#0f172a; font-weight: 500; padding:6px 0;">${valor !== null && valor !== undefined ? valor : '-'}</td></tr>`;
                }
                tablaHtml += `</table>`;

                document.getElementById('contenido-tabla-datos').innerHTML = tablaHtml;
                document.getElementById('panel-datos-parcela').style.display = 'flex';
                if (e && e.latlng) L.DomEvent.stopPropagation(e);
            });

            if (valorBuscadoOriginal) {
                const v = valorBuscadoOriginal.toLowerCase();
                const partida = p["PARTIDA"] ? p["PARTIDA"].toString().toLowerCase() : "";
                const tgi = p["TGIRural"] ? p["TGIRural"].toString().toLowerCase() : "";
                const titular = p["Tit. Nombre"] ? p["Tit. Nombre"].toString().toLowerCase() : "";
                
                if (partida === v || tgi === v || titular === v || titular.includes(v)) {
                    setTimeout(() => {
                        if (layer._path) layer._path.classList.add('parcela-titilando');
                        
                        if (!unLoteYaAbrioFicha) {
                            medirLadosDeParcela(feature); 
                            layer.fireEvent('click'); 
                            unLoteYaAbrioFicha = true;
                        }
                    }, 600);
                }
            }
        }
    }).addTo(map);

    if (map.hasLayer(capaZonas)) map.removeLayer(capaZonas);
    
    if (bounds && typeof bounds.isValid === 'function' && bounds.isValid()) {
        map.fitBounds(bounds, { padding: [30, 30] });
    }
    document.getElementById('btn-reset').style.display = 'block';
}

function cerrarPanelDatos() {
    document.getElementById('panel-datos-parcela').style.display = 'none';
    document.getElementById('contenido-tabla-datos').innerHTML = "";
    document.getElementById('input-busqueda').value = ""; 
}

// ==========================================================================
// 4. AUTOCOMPLETADO ROBUSTO Y BÚSQUEDA CATASTRAL
// ==========================================================================
function actualizarCoincidencias() {
    const valor = document.getElementById('input-busqueda').value.trim().toLowerCase();
    const datalist = document.getElementById('coincidencias');
    datalist.innerHTML = ""; 
    
    if (valor.length < 2 || !datosRuralesGlobal) return;
    let contador = 0;
    
    for (let f of datosRuralesGlobal.features) {
        const p = f.properties;
        const partida = p["PARTIDA"] ? p["PARTIDA"].toString().toLowerCase() : "";
        const tgi = p["TGIRural"] ? p["TGIRural"].toString().toLowerCase() : "";
        const titular = p["Tit. Nombre"] ? p["Tit. Nombre"].toString().toLowerCase() : "";
        
        if (partida.includes(valor) || tgi.includes(valor) || titular.includes(valor)) {
            const option = document.createElement('option');
            
            if (titular.includes(valor)) {
                option.value = p["Tit. Nombre"];
                option.label = `[TGI: ${p["TGIRural"]} | Partida: ${p["PARTIDA"]}]`;
            } else if (tgi.includes(valor)) {
                option.value = p["TGIRural"].toString();
                option.label = `[Titular: ${p["Tit. Nombre"] || 'S/D'} | Partida: ${p["PARTIDA"]}]`;
            } else {
                option.value = p["PARTIDA"].toString();
                option.label = `[TGI: ${p["TGIRural"]} | Titular: ${p["Tit. Nombre"] || 'S/D'}]`;
            }
            
            datalist.appendChild(option);
            contador++; 
            if (contador >= 10) break; 
        }
    }
}

function configurarLanzadorAutomaticoDatalist() {
    const input = document.getElementById('input-busqueda');
    if(!input) return;
    input.addEventListener('input', function(e) {
        const datalist = document.getElementById('coincidencias');
        for (let option of datalist.options) {
            if (input.value === option.value) {
                ejecutarBusqueda();
                input.blur(); 
                break;
            }
        }
    });
}

function ejecutarBusqueda() {
    let valorBuscado = document.getElementById('input-busqueda').value.trim();
    if (!valorBuscado) { alert("Ingrese un término para buscar."); return; }
    let vLow = valorBuscado.toLowerCase();

    const parcelasEncontradas = datosRuralesGlobal.features.filter(f => {
        const p = f.properties;
        const partida = p["PARTIDA"] ? p["PARTIDA"].toString().toLowerCase() : "";
        const tgi = p["TGIRural"] ? p["TGIRural"].toString().toLowerCase() : "";
        const titular = p["Tit. Nombre"] ? p["Tit. Nombre"].toString().toLowerCase() : "";
        return partida === vLow || tgi === vLow || titular === vLow || titular.includes(vLow);
    });

    if (parcelasEncontradas.length > 0) {
        const idHoja = parcelasEncontradas[0].properties.Hoja;
        const grupoTemporal = L.featureGroup(parcelasEncontradas.map(f => L.geoJSON(f)));
        const boundsGlobales = grupoTemporal.getBounds();
        
        comenzarAuditoriaZona(idHoja, boundsGlobales);
        setTimeout(() => { cargarParcelas(idHoja, boundsGlobales, valorBuscado); }, 200);
    } else { 
        alert("No se encontró ningún registro catastral coincidente."); 
    }
    
    cerrarMenuMovilSiCorresponde();
}

// ==========================================================================
// 5. CONTROLADORES DE REPORTES, GRÁFICOS Y TOP DEUDORES
// ==========================================================================
function toggleGraficoSemaforo() {
    const modal = document.getElementById('modal-grafico-barras');
    const btn = document.getElementById('btn-grafico');
    
    if (graficoVisible) {
        modal.style.display = 'none';
        btn.classList.remove('activo');
    } else {
        generarGraficoBarrasDinamicas();
        modal.style.display = 'block';
        btn.classList.add('activo');
    }
    graficoVisible = !graficoVisible;
}

function obtenerCategoriaSemaforo(periodos) {
    if (periodos >= 2 && periodos <= 3) return 'Amarillo';
    if (periodos >= 4) return 'Rojo';
    return 'Verde';
}

function generarGraficoBarrasDinamicas(idHojaFiltro = null) {
    if (!datosRuralesGlobal) return;
    
    let counts = { Verde: 0, Amarillo: 0, Rojo: 0 };
    let total = 0;
    
    datosRuralesGlobal.features.forEach(f => {
        let p = f.properties;
        if (idHojaFiltro !== null) {
            if (!p.Hoja || parseInt(p.Hoja, 10) !== parseInt(idHojaFiltro, 10)) return; 
        }

        let keyPeriodos = Object.keys(p).find(k => k.toLowerCase().includes("periodos")) || "Periodos Deuda";
        let periodos = parseInt(p[keyPeriodos], 10) || 0;
        counts[obtenerCategoriaSemaforo(periodos)]++;
        total++;
    });

    let pctV = total > 0 ? ((counts.Verde / total) * 100).toFixed(1) : 0;
    let pctA = total > 0 ? ((counts.Amarillo / total) * 100).toFixed(1) : 0;
    let pctR = total > 0 ? ((counts.Rojo / total) * 100).toFixed(1) : 0;

    let tituloGrafico = idHojaFiltro !== null ? `Sección / Hoja ${idHojaFiltro}` : "Estado Global Catastral";
    let fechaTexto = obtenerFechaDeuda();
    let subtituloFecha = fechaTexto ? `📅 Deuda a la fecha: ${fechaTexto}` : "📅 Deudas a la fecha";

    document.getElementById('contenedor-barras-dinamicas').innerHTML = `
        <div style="text-align: center; margin-bottom: 4px; font-weight: bold; color: #1e293b; font-size: 13px;">
            📊 ${tituloGrafico} (${total} u.)
        </div>
        <div style="text-align: center; margin-bottom: 12px; font-size: 11px; color: #0284c7; font-weight: 600;">
            ${subtituloFecha}
        </div>
        <div class="tarjeta-metrica-global">
            <div class="item-barra-progreso">
                <div class="info-barra"><span>🟢 Al Día</span> <strong>${pctV}%</strong></div>
                <div class="linea-progreso-fondo"><div class="linea-progreso-relleno verde" style="width: ${pctV}%"></div></div>
            </div>
            <div class="item-barra-progreso">
                <div class="info-barra"><span>🟡 Mediana</span> <strong>${pctA}%</strong></div>
                <div class="linea-progreso-fondo"><div class="linea-progreso-relleno amarillo" style="width: ${pctA}%"></div></div>
            </div>
            <div class="item-barra-progreso">
                <div class="info-barra"><span>🔴 Deuda</span> <strong>${pctR}%</strong></div>
                <div class="linea-progreso-fondo"><div class="linea-progreso-relleno rojo" style="width: ${pctR}%"></div></div>
            </div>
        </div>
        <div style="margin-top: 14px; padding-top: 10px; border-top: 1px solid #e2e8f0; display: flex; flex-direction: column; gap: 4px; font-size: 11px; color: #64748b;">
            <div style="display: flex; align-items: center; gap: 6px;">
                <span style="width: 10px; height: 10px; background-color: #2ecc71; border-radius: 50%; display: inline-block;"></span>
                <span><strong>Al Día:</strong> 0 a 1 período adeudado.</span>
            </div>
            <div style="display: flex; align-items: center; gap: 6px;">
                <span style="width: 10px; height: 10px; background-color: #f1c40f; border-radius: 50%; display: inline-block;"></span>
                <span><strong>Mediana:</strong> 2 a 3 períodos adeudados.</span>
            </div>
            <div style="display: flex; align-items: center; gap: 6px;">
                <span style="width: 10px; height: 10px; background-color: #e74c3c; border-radius: 50%; display: inline-block;"></span>
                <span><strong>Deuda:</strong> 4 o más períodos adeudados.</span>
            </div>
        </div>
    `;
}

function toggleTopDeudores() {
    const vistaCompleta = document.getElementById('pantalla-completa-top');
    const btn = document.getElementById('btn-top-deudores');
    
    if (topDeudoresVisible) {
        vistaCompleta.style.display = 'none';
        btn.classList.remove('activo');
    } else {
        generarGranTablaTop50Unificada();
        vistaCompleta.style.display = 'block';
        btn.classList.add('activo');
    }
    topDeudoresVisible = !topDeudoresVisible;
}

function generarGranTablaTop50Unificada() {
    if (!datosRuralesGlobal) return;
    
    let mapTGI = {};
    
    datosRuralesGlobal.features.forEach(f => {
        let p = f.properties;
        let tgiRaw = p["TGIRural"] ? p["TGIRural"].toString().trim() : "S/D";
        
        let keyPeriodos = Object.keys(p).find(k => k.toLowerCase().includes("periodos")) || "Periodos Deuda";
        let periodos = parseInt(p[keyPeriodos], 10) || 0;

        let keyMonto = Object.keys(p).find(k => k.toLowerCase().includes("total adeudado") || k.toLowerCase().includes("importe") || k.toLowerCase().includes("monto")) || "Total Adeudado sin judic.";
        let montoLimpio = limpiarMonto(p[keyMonto]);

        if (montoLimpio > 0) {
            if (!mapTGI[tgiRaw]) {
                mapTGI[tgiRaw] = {
                    tgi: tgiRaw,
                    titular: p["Tit. Nombre"] || "Sin Titular Registrado",
                    periodos: periodos, 
                    monto: montoLimpio  
                };
            } else {
                if (montoLimpio > mapTGI[tgiRaw].monto) mapTGI[tgiRaw].monto = montoLimpio;
                if (periodos > mapTGI[tgiRaw].periodos) mapTGI[tgiRaw].periodos = periodos;
            }
        }
    });

    let deudoresUnificados = Object.values(mapTGI);
    let deudoresFiltrados = deudoresUnificados.filter(d => d.periodos >= 6);
    deudoresFiltrados.sort((a, b) => b.monto - a.monto);

    let fechaTexto = obtenerFechaDeuda();
    let badgeFecha = fechaTexto ? `📅 Deuda a la fecha: ${fechaTexto}` : "📅 Deudas a la fecha";
    let columnaMontoTitulo = fechaTexto ? `Deuda Total TGI (al ${fechaTexto})` : "Deuda Total TGI a la Fecha";

    let filasTopHtml = "";
    deudoresFiltrados.forEach((d) => {
        filasTopHtml += `
            <tr onclick="hacerClicFilaTop('${d.tgi}')">
                <td style="padding: 14px 18px;"><span class="celda-tgi-resaltada">${d.tgi}</span></td>
                <td style="padding: 14px 18px; color: #0f172a; font-weight: 600; text-transform: uppercase; font-size: 12px;">${d.titular}</td>
                <td style="text-align: center; padding: 14px 18px;"><span class="badge-periodos badge-rojo">${d.periodos} Períodos</span></td>
                <td style="text-align: right; font-weight: 800; color: #dc2626; font-size: 14px; padding: 14px 18px; font-family: 'Courier New', Courier, monospace;">${formatearMoneda(d.monto)}</td>
            </tr>
        `;
    });

    document.getElementById('contenedor-tabla-grande-top').innerHTML = `
        <div style="margin-bottom: 15px; font-size: 13px; color: #64748b; font-style: italic; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px;">
            <span>* El presente informe detalla las obligaciones tributarias rurales por Código TGI que registran un estado de mora igual o superior a los 6 períodos fiscales.</span>
            <span style="font-weight: 700; color: #0284c7; background-color: #e0f2fe; padding: 4px 10px; border-radius: 4px; font-style: normal; font-size: 12px;">${badgeFecha}</span>
        </div>
        <table class="gran-tabla-reporte">
            <thead>
                <tr>
                    <th style="padding: 14px 18px; text-align: left;">Identificador TGI</th>
                    <th style="padding: 14px 18px; text-align: left;">Contribuyente / Titular Registral</th>
                    <th style="padding: 14px 18px; text-align: center; width: 200px;">Periodos Adeudados</th>
                    <th style="padding: 14px 18px; text-align: right; width: 260px;">${columnaMontoTitulo}</th>
                </tr>
            </thead>
            <tbody>
                ${filasTopHtml || '<tr><td colspan="4" style="text-align: center; padding: 40px; color: #94a3b8; font-size: 13px;">No se registran cuentas tributarias rurales activas que cumplan con los criterios de auditoría previstos.</td></tr>'}
            </tbody>
        </table>
    `;
}

function hacerClicFilaTop(tgiBuscado) {
    toggleTopDeudores();
    document.getElementById('input-busqueda').value = tgiBuscado;
    ejecutarBusqueda();
}

// ==========================================================================
// 6. HERRAMIENTAS GENERALES Y RESPONSIVE MÓVIL
// ==========================================================================
function volverAlMapa() {
    if (capaParcelas) map.removeLayer(capaParcelas);
    if (marcadorCoordenada) map.removeLayer(marcadorCoordenada);
    limpiarSeleccionCamino();
    capaSegmentosMedidos.clearLayers(); 
    cerrarPanelDatos();
    if (!map.hasLayer(capaZonas)) capaZonas.addTo(map);
    document.getElementById('btn-reset').style.display = 'none';
    document.getElementById('input-busqueda').value = ""; 
    document.getElementById('input-coordenadas').value = "";
    
    const modal = document.getElementById('modal-grafico-barras');
    const btn = document.getElementById('btn-grafico');
    if(modal && btn) {
        modal.style.display = 'none';
        btn.classList.remove('activo');
        graficoVisible = false;
    }

    map.fitBounds(capaZonas.getBounds());
}

function parsearDMSToDecimal(strInput) {
    if (!isNaN(parseFloat(strInput)) && !strInput.includes('°') && !strInput.includes("'")) return parseFloat(strInput);
    let partes = strInput.split(/[^\d\w\.]+/);
    let grados = parseFloat(partes[0]) || 0;
    let minutes = parseFloat(partes[1]) || 0;
    let segundos = parseFloat(partes[2]) || 0;
    let orientacion = strInput.toUpperCase();
    let res = grados + (minutes / 60) + (segundos / 3600);
    if (orientacion.includes('S') || orientacion.includes('W') || orientacion.includes('O')) res = res * -1;
    return res;
}

function buscarPorCoordenadas() {
    const rawValue = document.getElementById('input-coordenadas').value.trim();
    if (!rawValue) return;
    let partes = rawValue.split(','); if (partes.length !== 2) return;
    let lat = parsearDMSToDecimal(partes[0].trim());
    let lng = parsearDMSToDecimal(partes[1].trim());
    if (marcadorCoordenada) map.removeLayer(marcadorCoordenada);
    marcadorCoordenada = L.marker([lat, lng]).addTo(map).bindPopup(`Lat: ${lat}<br>Lng: ${lng}`).openPopup();
    map.setView([lat, lng], 14);
    document.getElementById('btn-reset').style.display = 'block';
    
    cerrarMenuMovilSiCorresponde();
}

function toggleMenuMovil() {
    const contenedor = document.getElementById('controles-colapsables');
    const boton = document.getElementById('btn-hamburguesa');
    if (!contenedor || !boton) return;
    
    if (contenedor.classList.contains('mostrar-menu')) {
        contenedor.classList.remove('mostrar-menu');
        boton.innerText = "☰";
    } else {
        contenedor.classList.add('mostrar-menu');
        boton.innerText = "✕";
    }
}

function cerrarMenuMovilSiCorresponde() {
    const contenedor = document.getElementById('controles-colapsables');
    const boton = document.getElementById('btn-hamburguesa');
    if (contenedor && contenedor.classList.contains('mostrar-menu')) {
        contenedor.classList.remove('mostrar-menu');
        if (boton) boton.innerText = "☰";
    }
}