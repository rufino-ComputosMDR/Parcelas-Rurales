const map = L.map('map').setView([-34.15, -62.6], 10);
let capaZonas, capaParcelas, capaReferencias, marcadorCoordenada;
let capaSegmentosMedidos = L.featureGroup(); 
let datosRuralesGlobal = null; 
let datosReferenciasGlobal = null; 
let referenciasVisibles = false;

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
    .then(data => { datosRuralesGlobal = data; })
    .catch(err => console.error("Error rurales:", err));


// APAGA EL PLANO GENERAL Y NORMALIZA EL ID A ENTERO PURO
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

// OBTENER RUMBO DE LA RECTA
function obtenerRumbo(pt1, pt2) {
    let dLng = (pt2.lng - pt1.lng) * Math.cos(Math.PI / 180 * pt1.lat);
    let dLat = pt2.lat - pt1.lat;
    let angle = Math.atan2(dLng, dLat) * 180 / Math.PI;
    return (angle + 360) % 360;
}

// SIMPLIFICACIÓN GEOMÉTRICA POR RUMBOS CONTINUOS (MEDICIÓN SEGÚN FORMA REAL)
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

            let lineaLado = L.polyline([esquina1, esquina2], {
                color: '#2980b9',
                weight: 4,
                opacity: 0.85
            });

            lineaLado.bindTooltip(`${distanciaLadoCompleto.toFixed(1)} m`, {
                permanent: true,
                direction: 'center',
                className: 'etiqueta-medida-segmento'
            });

            capaSegmentosMedidos.addLayer(lineaLado);
        }
    });

    capaSegmentosMedidos.addTo(map);
}

// INYECCIÓN DE LA TABLA AL PANEL FIJO LATERAL DERECHO
function mostrarFichaEnPanelLateral(properties, idHoja) {
    const panel = document.getElementById('panel-ficha-derecho');
    const p = properties;

    let fichaHtml = `
        <div class="ficha-auditoria-container">
            <div class="ficha-auditoria-header">
                <span>HOJA ${p.Hoja || idHoja}</span>
                <h3>FICHA DE PARCELA</h3>
                <button class="cerrar-panel-ficha" onclick="cerrarPanelFicha()">✕</button>
            </div>
            <div class="ficha-auditoria-body">
                <table class="ficha-tabla-dinamica">
    `;

    for (let key in p) {
        let valor = p[key];
        let keyLower = key.toLowerCase();
        let claseEstilo = "";
        
        if (keyLower.includes("fecha")) {
            valor = valor || "---";
            claseEstilo = "td-fecha";
        } else if (keyLower.includes("periodos")) {
            valor = parseInt(valor, 10);
            if (isNaN(valor)) valor = 0;
            claseEstilo = "td-periodos";
        } else if (keyLower.includes("total adeudado") || keyLower.includes("deuda") || keyLower.includes("monto")) {
            valor = formatearMoneda(valor);
            claseEstilo = "td-monto";
        }
        
        fichaHtml += `
            <tr>
                <td class="label-col">${key}</td>
                <td class="value-col ${claseEstilo}">${valor}</td>
            </tr>
        `;
    }

    fichaHtml += `</table></div></div>`;
    panel.innerHTML = fichaHtml;
    panel.style.display = 'block';
}

function cerrarPanelFicha() {
    document.getElementById('panel-ficha-derecho').style.display = 'none';
    capaSegmentosMedidos.clearLayers();
}

// 3. CAPA PARCELAS COMPLETA CON PARCHE DE PROTECCIÓN GEOMÉTRICA (EVITA EL ERROR LATLNGS)
function cargarParcelas(idHoja, bounds, idParcelaAIluminar = null) {
    if (capaParcelas) map.removeLayer(capaParcelas);
    capaSegmentosMedidos.clearLayers(); 
    document.getElementById('panel-ficha-derecho').style.display = 'none';
    renderizarCapaParcelas(idHoja, bounds, idParcelaAIluminar);
}

function renderizarCapaParcelas(idHoja, bounds, idParcelaAIluminar) {
    capaParcelas = L.geoJSON(datosRuralesGlobal, {
        // FILTRADO CON CONTROL DE INTEGRIDAD
        filter: (feature) => {
            if (!feature.properties || !feature.properties.Hoja) return false;
            
            // Si la parcela no tiene coordenadas asignadas o viene rota en el GeoJSON, la saltea silenciosamente
            if (!feature.geometry || !feature.geometry.coordinates || feature.geometry.coordinates.length === 0) {
                console.warn(`Aviso Catastral: Se omitió un lote en la Hoja ${idHoja} por geometría ausente o corrupta.`);
                return false;
            }
            
            return parseInt(feature.properties.Hoja, 10) === parseInt(idHoja, 10);
        },
        style: (feature) => {
            if (idParcelaAIluminar && feature.properties.PARTIDA === idParcelaAIluminar) {
                return { color: '#000000', weight: 3, fillColor: '#ffff00', fillOpacity: 0.5 };
            }
            return { color: '#d35400', weight: 1, fillColor: '#e67e22', fillOpacity: 0.2 };
        },
        onEachFeature: (feature, layer) => {
            const p = feature.properties;
            
            // CONTROL DE SEGURIDAD PARA EL TOOLTIP: Verifica si el polígono responde límites válidos
            if (p.TGIRural && typeof layer.getBounds === 'function') {
                try {
                    const boundsLayer = layer.getBounds();
                    if (boundsLayer.isValid()) {
                        layer.bindTooltip(p.TGIRural.toString(), { 
                            permanent: true, 
                            direction: 'center', 
                            className: 'etiqueta-parcela' 
                        });
                    }
                } catch (error) {
                    console.error("Leaflet no pudo calcular el centro del polígono para el Tooltip:", p.TGIRural, error);
                }
            }

            layer.on('click', function(e) {
                medirLadosDeParcela(feature);
                mostrarFichaEnPanelLateral(p, idHoja);
                L.DomEvent.stopPropagation(e);
            });

            if (idParcelaAIluminar && p.PARTIDA === idParcelaAIluminar) {
                setTimeout(() => {
                    if (layer._path) layer._path.classList.add('parcela-titilando');
                    medirLadosDeParcela(feature); 
                    mostrarFichaEnPanelLateral(p, idHoja);
                }, 600);
            }
        }
    }).addTo(map);

    if (map.hasLayer(capaZonas)) map.removeLayer(capaZonas);
    
    // Zoom elástico dinámico: si falla el bound nativo de la zona, encuadra las parcelas reales renderizadas en pantalla
    if (bounds && typeof bounds.isValid === 'function' && bounds.isValid()) {
        map.fitBounds(bounds, { padding: [30, 120] });
    } else if (capaParcelas.getLayers().length > 0) {
        map.fitBounds(capaParcelas.getBounds(), { padding: [30, 120] });
    }

    document.getElementById('btn-reset').style.display = 'block';
}

// 4. AUTOCOMPLETADO OPTIMIZADO
function actualizarCoincidencias() {
    const valor = document.getElementById('input-busqueda').value.trim().toLowerCase();
    const datalist = document.getElementById('coincidencias');
    datalist.innerHTML = ""; 
    
    if (valor.length < 2 || !datosRuralesGlobal) return;
    let contador = 0;
    
    for (let f of datosRuralesGlobal.features) {
        const p = f.properties;
        const partida = p["PARTIDA"] ? p["PARTIDA"].toString() : "";
        const tgi = p["TGIRural"] ? p["TGIRural"].toString() : "";
        const titular = p["Tit. Nombre"] ? p["Tit. Nombre"].toString() : "";
        
        if (partida.toLowerCase().includes(valor) || tgi.toLowerCase().includes(valor) || titular.toLowerCase().includes(valor)) {
            const option = document.createElement('option');
            if (titular && titular.toLowerCase().includes(valor)) {
                option.value = titular;
            } else if (tgi.toLowerCase().includes(valor)) {
                option.value = tgi;
            } else {
                option.value = partida;
            }
            option.label = `(TGI: ${tgi} | Partida: ${partida})`;
            datalist.appendChild(option);
            contador++; 
            if (contador >= 8) break; 
        }
    }
}

function capturarSeleccionDatalist(valor) {
    if (!datosRuralesGlobal) return;
    const opciones = document.getElementById('coincidencias').childNodes;
    for (let i = 0; i < opciones.length; i++) {
        if (opciones[i].value === valor) {
            ejecutarBusqueda();
            break;
        }
    }
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
        hacerFocoEnParcelas(parcelasEncontradas);
    } else { 
        alert("No se encontró ningún registro catastral coincidente."); 
    }
}

function hacerFocoEnParcelas(listaParcelas) {
    const idHoja = listaParcelas[0].properties.Hoja;
    const partidaPrincipal = listaParcelas[0].properties.PARTIDA;
    const grupoTemporal = L.featureGroup(listaParcelas.map(f => L.geoJSON(f)));
    const boundsGlobales = grupoTemporal.getBounds();
    comenzarAuditoriaZona(idHoja, boundsGlobales);
    setTimeout(() => { cargarParcelas(idHoja, boundsGlobales, partidaPrincipal); }, 200);
}

// 6. RANKING DE DEUDORES
function mostrarTopDeudores() {
    if (!datosRuralesGlobal) { alert("Cargando datos..."); return; }
    const tableBody = document.getElementById('cuerpo-tabla-reporte');
    tableBody.innerHTML = ""; 
    
    let listaParcelas = datosRuralesGlobal.features.map(f => f.properties);
    const columnaDeuda = "Total Adeudado sin Judic.";
    listaParcelas.sort((a, b) => limpiarMonto(b[columnaDeuda]) - limpiarMonto(a[columnaDeuda]));

    let tgiProcesados = new Set();
    let listaFiltradaSinRepetir = [];

    for (let p of listaParcelas) {
        let tgi = p["TGIRural"] ? p["TGIRural"].toString().trim() : null;
        let keyPeriodos = Object.keys(p).find(k => k.toLowerCase().includes("periodos")) || "Periodos Deuda";
        let periodos = parseInt(p[keyPeriodos], 10);
        if (isNaN(periodos)) periodos = 0;
        if (periodos <= 5) continue; 
        if (tgi) {
            if (tgiProcesados.has(tgi)) continue; 
            tgiProcesados.add(tgi);
            listaFiltradaSinRepetir.push(p);
        }
        if (listaFiltradaSinRepetir.length >= 50) break;
    }

    listaFiltradaSinRepetir.forEach((p, index) => {
        let tgi = p["TGIRural"] || "---";
        let nombre = p["Tit. Nombre"] || "SIN TITULAR";
        let keyPeriodos = Object.keys(p).find(k => k.toLowerCase().includes("periodos")) || "Periodos Deuda";
        let periodos = parseInt(p[keyPeriodos], 10);
        if (isNaN(periodos)) periodos = 0;
        let deudaFormateada = formatearMoneda(p[columnaDeuda]);

        const fila = document.createElement('tr');
        fila.innerHTML = `
            <td><strong>${index + 1}</strong></td>
            <td><a href="#" class="link-tgi-mapa" onclick="irAParcelaDesdeReporte('${tgi}')">🎯 ${tgi}</a></td>
            <td>${nombre}</td>
            <td style="text-align: center; color: #7f8c8d; font-weight: bold;">${periodos}</td>
            <td style="font-weight: bold; color: #c0392b;">${deudaFormateada}</td>
        `;
        tableBody.appendChild(fila);
    });

    document.getElementById('map').style.display = 'none';
    document.getElementById('panel-busqueda-lateral').style.display = 'none';
    document.getElementById('contenedor-logo-mapa').style.display = 'none';
    document.getElementById('panel-ficha-derecho').style.display = 'none';
    document.querySelector('.botones-controles-derechos').style.display = 'none';
    document.getElementById('pantalla-reporte').style.display = 'block';
}

function irAParcelaDesdeReporte(tgiBuscado) {
    if (!datosRuralesGlobal) return;
    let tgiBuscadoLimpio = tgiBuscado.toString().trim().toUpperCase();
    const parcelas = datosRuralesGlobal.features.filter(f => {
        if (!f.properties.TGIRural) return false;
        let tgiGeoJson = f.properties.TGIRural.toString().trim().toUpperCase();
        if (tgiGeoJson === tgiBuscadoLimpio) return true;
        let tgiBuscadoSinCeros = tgiBuscadoLimpio.replace(/^0+/, '');
        let tgiGeoJsonSinCeros = tgiGeoJson.replace(/^0+/, '');
        return tgiBuscadoSinCeros === tgiGeoJsonSinCeros;
    });
    if (parcelas.length > 0) { 
        cerrarReporte(); 
        hacerFocoEnParcelas(parcelas); 
    } else { 
        alert(`No se localizó la parcela con TGI "${tgiBuscado}" en el mapa.`); 
    }
}

// 7. CONTROLES GENERALES Y RE-ENCENDIDO DE VISTA GENERAL
function cerrarReporte() {
    document.getElementById('pantalla-reporte').style.display = 'none';
    document.getElementById('map').style.display = 'block';
    document.getElementById('panel-busqueda-lateral').style.display = 'block';
    document.getElementById('contenedor-logo-mapa').style.display = 'block';
    document.querySelector('.botones-controles-derechos').style.display = 'flex';
    if (capaParcelas && map.hasLayer(capaParcelas)) document.getElementById('btn-reset').style.display = 'block';
    setTimeout(() => { map.invalidateSize(); }, 100);
}

function volverAlMapa() {
    if (capaParcelas) map.removeLayer(capaParcelas);
    if (marcadorCoordenada) map.removeLayer(marcadorCoordenada);
    capaSegmentosMedidos.clearLayers(); 
    document.getElementById('panel-ficha-derecho').style.display = 'none';
    
    // Enciende nuevamente el mapa completo de zonas de colores
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