const map = L.map('map').setView([-34.15, -62.6], 10);
let capaZonas, capaParcelas, capaReferencias, marcadorCoordenada;
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

function comenzarAuditoriaZona(idHoja, bounds) {
    cargarParcelas(idHoja, bounds);
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

// 3. CAPA PARCELAS CON FICHA RECTANGULAR DINÁMICA
function cargarParcelas(idHoja, bounds, idParcelaAIluminar = null) {
    if (capaParcelas) map.removeLayer(capaParcelas);
    renderizarCapaParcelas(idHoja, bounds, idParcelaAIluminar);
}

function renderizarCapaParcelas(idHoja, bounds, idParcelaAIluminar) {
    capaParcelas = L.geoJSON(datosRuralesGlobal, {
        filter: (feature) => feature.properties.Hoja == idHoja,
        style: (feature) => {
            if (idParcelaAIluminar && feature.properties.PARTIDA === idParcelaAIluminar) {
                return { color: '#000000', weight: 3, fillColor: '#ffff00', fillOpacity: 0.8 };
            }
            return { color: '#d35400', weight: 1, fillColor: '#e67e22', fillOpacity: 0.3 };
        },
        onEachFeature: (feature, layer) => {
            const p = feature.properties;
            if (p.TGIRural) {
                layer.bindTooltip(p.TGIRural.toString(), { permanent: true, direction: 'center', className: 'etiqueta-parcela' });
            }
            
            let fichaHtml = `
                <div class="ficha-auditoria-container">
                    <div class="ficha-auditoria-header">
                        <span>HOJA ${p.Hoja || idHoja}</span>
                        <h3>FICHA DE PARCELA</h3>
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

            layer.bindPopup(fichaHtml, { 
                autoPanPadding: L.point(15, 60),
                maxWidth: 340,
                minWidth: 290
            });

            if (idParcelaAIluminar && p.PARTIDA === idParcelaAIluminar) {
                setTimeout(() => {
                    if (layer._path) layer._path.classList.add('parcela-titilando');
                    layer.openPopup(); 
                }, 600);
            }
        }
    }).addTo(map);

    if (map.hasLayer(capaZonas)) map.removeLayer(capaZonas);
    map.fitBounds(bounds, { padding: [30, 30] });
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
            option.value = titular ? titular : `Partida: ${partida}`;
            option.label = `(TGI: ${tgi} | Partida: ${partida})`;
            datalist.appendChild(option);
            contador++; 
            if (contador >= 8) break; 
        }
    }
}

// 5. MOTOR DE BÚSQUEDA CATASTRAL
function ejecutarBusqueda() {
    let valorBuscado = document.getElementById('input-busqueda').value.trim().toLowerCase();
    if (!valorBuscado) { alert("Ingrese un término para buscar."); return; }

    const parcelaEncontrada = datosRuralesGlobal.features.find(f => {
        const p = f.properties;
        const partida = p["PARTIDA"] ? p["PARTIDA"].toString().toLowerCase() : "";
        const tgi = p["TGIRural"] ? p["TGIRural"].toString().toLowerCase() : "";
        const titular = p["Tit. Nombre"] ? p["Tit. Nombre"].toString().toLowerCase() : "";
        
        return partida === valorBuscado || tgi === valorBuscado || titular === valorBuscado || titular.includes(valorBuscado);
    });

    if (parcelaEncontrada) {
        hacerFocoEnParcela(parcelaEncontrada);
    } else { 
        alert("No se encontró ningún registro catastral coincidente."); 
    }
}

function hacerFocoEnParcela(parcela) {
    const idHoja = parcela.properties.Hoja;
    const partida = parcela.properties.PARTIDA;
    const capaTemporal = L.geoJSON(parcela);
    comenzarAuditoriaZona(idHoja, capaTemporal.getBounds());
    setTimeout(() => { cargarParcelas(idHoja, capaTemporal.getBounds(), partida); }, 200);
}

// 6. RANKING DE DEUDORES CON TGI BLINDADO
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
    document.querySelector('.botones-controles-derechos').style.display = 'none';
    document.getElementById('pantalla-reporte').style.display = 'block';
}

function irAParcelaDesdeReporte(tgiBuscado) {
    if (!datosRuralesGlobal) return;
    let tgiBuscadoLimpio = tgiBuscado.toString().trim().toUpperCase();

    const parcela = datosRuralesGlobal.features.find(f => {
        if (!f.properties.TGIRural) return false;
        let tgiGeoJson = f.properties.TGIRural.toString().trim().toUpperCase();
        if (tgiGeoJson === tgiBuscadoLimpio) return true;
        
        let tgiBuscadoSinCeros = tgiBuscadoLimpio.replace(/^0+/, '');
        let tgiGeoJsonSinCeros = tgiGeoJson.replace(/^0+/, '');
        return tgiBuscadoSinCeros === tgiGeoJsonSinCeros;
    });

    if (parcela) { 
        cerrarReporte(); 
        hacerFocoEnParcela(parcela); 
    } else { 
        alert(`No se localizó la parcela con TGI "${tgiBuscado}" en el mapa.`); 
    }
}

// 7. CONTROLES GENERALES Y COORDENADAS
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
    let minutos = parseFloat(partes[1]) || 0;
    let segundos = parseFloat(partes[2]) || 0;
    let orientacion = strInput.toUpperCase();
    let res = grados + (minutos / 60) + (segundos / 3600);
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