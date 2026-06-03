const map = L.map('map').setView([-34.15, -62.6], 10);
let capaZonas, capaParcelas, capaReferencias, marcadorCoordenada;
let capaSegmentosMedidos = L.featureGroup(); 
let datosRuralesGlobal = null; 
let datosReferenciasGlobal = null; 
let referenciasVisibles = false;
let graficoVisible = false;
let topDeudoresVisible = false;

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap'
}).addTo(map);

const colores = ['#e6194b', '#3cb44b', '#ffe119', '#4363d8', '#f58231', '#911eb4'];

function limpiarMonto(texto) {
    if (texto === null || texto === undefined) return 0;
    if (typeof texto === 'number') return texto;
    let str = texto.toString().trim();
    if (!str) return 0;
    str = str.replace(/\$/g, '').replace(/\s+/g, '');
    if (str.includes(',') && !str.includes('.')) {
        str = str.replace(',', '.');
    } else if (str.includes(',') && str.includes('.')) {
        str = str.replace(/\./g, '').replace(',', '.');
    } else if (str.includes('.') && str.split('.').pop().length > 2) {
        str = str.replace(/\./g, '');
    }
    let resultadoFlotante = parseFloat(str);
    return isNaN(resultadoFlotante) ? 0 : resultadoFlotante;
}

function formatearMoneda(valor) {
    let numero = limpiarMonto(valor);
    return "$ " + numero.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// 1. CARGA DE ARCHIVOS GEOJSON
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
        prepararCapaReferencias();
    })
    .catch(err => console.error("Error zonas:", err));

fetch('rurales.geojson')
    .then(res => res.json())
    .then(data => { 
        datosRuralesGlobal = data; 
        // Escuchador para detectar cuando el usuario selecciona una opción del datalist
        configurarLanzadorAutomaticoDatalist();
    })
    .catch(err => console.error("Error rurales:", err));


function comenzarAuditoriaZona(idHoja, bounds) {
    if (map.hasLayer(capaZonas)) {
        map.removeLayer(capaZonas); 
    }
    const idHojaNumerico = parseInt(idHoja, 10);
    cargarParcelas(idHojaNumerico, bounds);
}

// 2. REFERENCIAS
function prepararCapaReferencias() {
    fetch('referencias.geojson')
        .then(res => res.json())
        .then(data => {
            datosReferenciasGlobal = data; 
            capaReferencias = L.geoJSON(data, {
                pointToLayer: function (feature, latlng) {
                    let p = feature.properties;
                    let nombreVisible = p.Name || "Punto sin nombre";
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
}

function toggleReferencias() {
    if (!capaReferencias) return;
    if (referenciasVisibles) {
        map.removeLayer(capaReferencias);
        document.getElementById('btn-referencias').innerText = "📍 Mostrar Referencias";
        document.getElementById('btn-referencias').classList.remove('activo');
    } else {
        capaReferencias.addTo(map);
        document.getElementById('btn-referencias').innerText = "📍 Ocultar Referencias";
        document.getElementById('btn-referencias').classList.add('activo');
    }
    referenciasVisibles = !referenciasVisibles;
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

// 3. CAPA PARCELAS CON PANEL DE DATOS FIJO E IZQUIERDO
function cargarParcelas(idHoja, bounds, idParcelaAIluminar = null) {
    if (capaParcelas) map.removeLayer(capaParcelas);
    capaSegmentosMedidos.clearLayers(); 
    renderizarCapaParcelas(idHoja, bounds, idParcelaAIluminar);
}

function renderizarCapaParcelas(idHoja, bounds, idParcelaAIluminar) {
    capaParcelas = L.geoJSON(datosRuralesGlobal, {
        filter: (feature) => {
            if (!feature.properties || !feature.properties.Hoja) return false;
            if (!feature.geometry || !feature.geometry.coordinates || feature.geometry.coordinates.length === 0) return false;
            return parseInt(feature.properties.Hoja, 10) === parseInt(idHoja, 10);
        },
        style: (feature) => {
            const p = feature.properties;
            if (idParcelaAIluminar && p.PARTIDA === idParcelaAIluminar) {
                return { color: '#002855', weight: 4, fillColor: '#00b4d8', fillOpacity: 0.8 };
            }
            let keyPeriodos = Object.keys(p).find(k => k.toLowerCase().includes("periodos")) || "Periodos Deuda";
            let periodos = parseInt(p[keyPeriodos]) || 0;
            let colorSemaforo = '#2ecc71'; 

            if (periodos >= 2 && periodos <= 3) { colorSemaforo = '#f1c40f'; } 
            else if (periodos >= 4) { colorSemaforo = '#e74c3c'; }

            return { color: '#7f8c8d', weight: 1, fillColor: colorSemaforo, fillOpacity: 0.5 };
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

                let tablaHtml = `<table class="ficha-tabla">`;
                for (let key in p) {
                    let valor = p[key];
                    let keyMinuscula = key.toLowerCase();

                    if (keyMinuscula.includes("periodos deuda")) {
                        valor = parseInt(valor, 10) || 0;
                    } else if (keyMinuscula === "total adeudado sin judic." || keyMinuscula.includes("importe") || keyMinuscula.includes("monto")) {
                        valor = formatearMoneda(valor);
                    }
                    tablaHtml += `<tr><td class="label" style="font-weight:bold; color:#7f8c8d; padding-right:15px; font-size:11px;">${key}</td><td style="font-size:11px; color:#333; font-weight: 500;">${valor}</td></tr>`;
                }
                tablaHtml += `</table>`;

                document.getElementById('contenido-tabla-datos').innerHTML = tablaHtml;
                document.getElementById('panel-datos-parcela').style.display = 'block';
                if (e && e.latlng) L.DomEvent.stopPropagation(e);
            });

            if (idParcelaAIluminar && p.PARTIDA === idParcelaAIluminar) {
                setTimeout(() => {
                    if (layer._path) layer._path.classList.add('parcela-titilando');
                    medirLadosDeParcela(feature); 
                    layer.fireEvent('click'); 
                }, 600);
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
}

// 4. AUTOCOMPLETADO CORREGIDO PARA TEXTO Y LETRAS
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
        
        // Verifica si el término ingresado (letras o números) coincide con alguna propiedad
        if (partida.includes(valor) || tgi.includes(valor) || titular.includes(valor)) {
            const option = document.createElement('option');
            
            // Priorizamos mostrar en el value el dato exacto con el que hubo coincidencia tipográfica
            if (titular.includes(valor)) {
                option.value = p["Tit. Nombre"];
            } else if (tgi.includes(valor)) {
                option.value = p["TGIRural"].toString();
            } else {
                option.value = p["PARTIDA"].toString();
            }
            
            option.label = `(TGI: ${p["TGIRural"]} | Partida: ${p["PARTIDA"]} | ${p["Tit. Nombre"] || 'S/D'})`;
            datalist.appendChild(option);
            contador++; 
            if (contador >= 12) break; // Mostramos hasta 12 opciones legibles
        }
    }
}

// Lanza la búsqueda automática en el mapa cuando detecta que se seleccionó una de las opciones
function configurarLanzadorAutomaticoDatalist() {
    const input = document.getElementById('input-busqueda');
    input.addEventListener('input', function(e) {
        const datalist = document.getElementById('coincidencias');
        // Si el valor ingresado coincide exactamente con una de las opciones disponibles del datalist, se ejecuta solo
        for (let option of datalist.options) {
            if (input.value === option.value) {
                ejecutarBusqueda();
                input.blur(); // Quita el foco del buscador para cerrar el teclado virtual/móvil
                break;
            }
        }
    });
}

// 5. MOTOR DE BÚSQUEDA CATASTRAL
function ejecutarBusqueda() {
    let valorBuscado = document.getElementById('input-busqueda').value.trim().toLowerCase();
    if (!valorBuscado) { alert("Ingrese un término para buscar."); return; }

    const parcelasEncontradas = datosRuralesGlobal.features.filter(f => {
        const p = f.properties;
        const partida = p["PARTIDA"] ? p["PARTIDA"].toString().toLowerCase() : "";
        const tgi = p["TGIRural"] ? p["TGIRural"].toString().toLowerCase() : "";
        const titular = p["Tit. Nombre"] ? p["Tit. Nombre"].toString().toLowerCase() : "";
        return partida === valorBuscado || tgi === valorBuscado || titular === valorBuscado || titular.includes(valorBuscado);
    });

    if (parcelasEncontradas.length > 0) {
        const idHoja = parcelasEncontradas[0].properties.Hoja;
        const partidaPrincipal = parcelasEncontradas[0].properties.PARTIDA;
        const grupoTemporal = L.featureGroup(parcelasEncontradas.map(f => L.geoJSON(f)));
        const boundsGlobales = grupoTemporal.getBounds();
        comenzarAuditoriaZona(idHoja, boundsGlobales);
        setTimeout(() => { cargarParcelas(idHoja, boundsGlobales, partidaPrincipal); }, 200);
    } else { 
        alert("No se encontró ningún registro catastral coincidente."); 
    }
}

// 6. CONTROLADOR DE VENTANA: GRÁFICO SEMÁFORO (SÓLO PORCENTAJES)
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

function generarGraficoBarrasDinamicas() {
    if (!datosRuralesGlobal) return;
    
    let total = datosRuralesGlobal.features.length;
    let counts = { Verde: 0, Amarillo: 0, Rojo: 0 };
    
    datosRuralesGlobal.features.forEach(f => {
        let p = f.properties;
        let keyPeriodos = Object.keys(p).find(k => k.toLowerCase().includes("periodos")) || "Periodos Deuda";
        let periodos = parseInt(p[keyPeriodos], 10) || 0;
        counts[obtenerCategoriaSemaforo(periodos)]++;
    });

    let pctV = total > 0 ? ((counts.Verde / total) * 100).toFixed(1) : 0;
    let pctA = total > 0 ? ((counts.Amarillo / total) * 100).toFixed(1) : 0;
    let pctR = total > 0 ? ((counts.Rojo / total) * 100).toFixed(1) : 0;

    document.getElementById('contenedor-barras-dinamicas').innerHTML = `
        <div class="tarjeta-metrica-global">
            <div class="item-barra-progreso">
                <div class="info-barra"><span>🟢 Al Día (0-1 per.)</span> <strong>${pctV}%</strong></div>
                <div class="linea-progreso-fondo"><div class="linea-progreso-relleno verde" style="width: ${pctV}%"></div></div>
            </div>
            <div class="item-barra-progreso">
                <div class="info-barra"><span>🟡 Mediana (2-3 per.)</span> <strong>${pctA}%</strong></div>
                <div class="linea-progreso-fondo"><div class="linea-progreso-relleno amarillo" style="width: ${pctA}%"></div></div>
            </div>
            <div class="item-barra-progreso">
                <div class="info-barra"><span>🔴 Crítica (4+ per.)</span> <strong>${pctR}%</strong></div>
                <div class="linea-progreso-fondo"><div class="linea-progreso-relleno rojo" style="width: ${pctR}%"></div></div>
            </div>
        </div>
    `;
}

// 7. CONTROLADOR DE PANTALLA COMPLETA: DEUDORES TOP 50
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
                    titular: p["Tit. Nombre"] || "Sin Titular",
                    periodos: periodos, 
                    monto: montoLimpio  
                };
            } else {
                mapTGI[tgiRaw].monto += montoLimpio;
                if (periodos > mapTGI[tgiRaw].periodos) {
                    mapTGI[tgiRaw].periodos = periodos;
                }
            }
        }
    });

    let deudoresUnificados = Object.values(mapTGI);
    let deudoresFiltrados = deudoresUnificados.filter(d => d.periodos >= 6);
    deudoresFiltrados.sort((a, b) => b.monto - a.monto);

    let filasTopHtml = "";
    deudoresFiltrados.forEach((d) => {
        filasTopHtml += `
            <tr onclick="hacerClicFilaTop('${d.tgi}')">
                <td><span class="celda-tgi-resaltada">${d.tgi}</span></td>
                <td><b>${d.titular}</b></td>
                <td style="text-align:center;"><span class="badge-periodos badge-rojo">${d.periodos} períodos</span></td>
                <td style="text-align:right; font-weight:700; color:#1e293b; font-size:14px;">${formatearMoneda(d.monto)}</td>
            </tr>
        `;
    });

    document.getElementById('contenedor-tabla-grande-top').innerHTML = `
        <table class="gran-tabla-reporte">
            <thead>
                <tr>
                    <th>Código TGI</th>
                    <th>Contribuyente / Titular Catastral</th>
                    <th style="text-align:center; width:180px;">Estado Deuda</th>
                    <th style="text-align:right; width:220px;">Monto Total Adeudado Unificado</th>
                </tr>
            </thead>
            <tbody>
                ${filasTopHtml || '<tr><td colspan="4" style="text-align:center; padding:30px; color:#95a5a6; font-size:14px;">No se registran cuentas rurales que cumplan con el criterio de 6 o más períodos adeudados.</td></tr>'}
            </tbody>
        </table>
    `;
}

function hacerClicFilaTop(tgiBuscado) {
    toggleTopDeudores();
    document.getElementById('input-busqueda').value = tgiBuscado;
    ejecutarBusqueda();
}

// 8. CONTROLES GENERALES Y RESETEO
function volverAlMapa() {
    if (capaParcelas) map.removeLayer(capaParcelas);
    if (marcadorCoordenada) map.removeLayer(marcadorCoordenada);
    capaSegmentosMedidos.clearLayers(); 
    cerrarPanelDatos();
    if (!map.hasLayer(capaZonas)) capaZonas.addTo(map);
    document.getElementById('btn-reset').style.display = 'none';
    document.getElementById('input-busqueda').value = ""; 
    document.getElementById('input-coordenadas').value = "";
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
}