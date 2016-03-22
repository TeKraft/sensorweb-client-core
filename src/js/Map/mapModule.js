angular.module('n52.core.map', [])
        .factory('mapService', ['$rootScope', 'leafletBoundsHelpers', 'interfaceService', 'statusService', 'settingsService', 'utils',
            function ($rootScope, leafletBoundsHelpers, interfaceService, statusService, settingsService, utils) {
                var stationMarkerIcon = settingsService.stationIconOptions ? settingsService.stationIconOptions : {};
                var baselayer = settingsService.baselayer ? settingsService.baselayer : {
                    osm: {
                        name: 'Open Street Map',
                        type: 'xyz',
                        url: 'http://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
                        layerOptions: {
                            showOnSelector: true
                        }
                    }
                };
                var overlays = angular.extend(settingsService.overlays,
                        {
                            cluster: {
                                name: 'Stations',
                                type: 'markercluster',
                                visible: true,
                                layerOptions: {
                                    showOnSelector: false
                                }
                            }
                        });
                var map = {};
                if (settingsService.showScale) {
                    map.controls = {
                        scale: true
                    };
                }
                var aggregateCounter;
                var aggregateBounds;

                var init = function () {
                    map.loading = false;
                    map.markers = {};
                    map.paths = {};
                    map.popup = {};
                    map.bounds = {};
                    map.center = {};
                    map.layers = {
                        baselayers: baselayer,
                        overlays: overlays
                    };

                    $rootScope.$on('allPhenomenaSelected', function (evt) {
                        map.selectedPhenomenon = null;
                        requestStations();
                    });
                    $rootScope.$on('phenomenonSelected', function (evt, phenomenon) {
                        map.selectedPhenomenon = phenomenon;
                        requestStations(phenomenon);
                    });
                    $rootScope.$on('redrawStations', function (evt, phenomenon) {
                        requestStations(map.selectedPhenomenon);
                    });
                    $rootScope.$on('newProviderSelected', function (evt) {
                        requestStations();
                    });

                    requestStations();
                };

                var requestStations = function (phenomenon) {
                    angular.copy({}, map.markers);
                    map.loading = true;
                    var params;
                    if (settingsService.aggregateServices && angular.isUndefined(statusService.status.apiProvider.url)) {
                        requestAggregatedStations(phenomenon);
                    } else {
                        if (statusService.status.concentrationMarker && phenomenon) {
                            angular.forEach(phenomenon.provider, function (provider) {
                                params = {
                                    service: provider.serviceID,
                                    phenomenon: provider.phenomenonID,
                                    expanded: true,
                                    force_latest_values: true,
                                    status_intervals: true
                                };
                                interfaceService.getTimeseries(null, provider.url, params).then(function (data) {
                                    createMarkers(data, provider.url, provider.serviceID);
                                });
                            });
                        } else {
                            var provider;
                            if (phenomenon) {
                                angular.forEach(phenomenon.provider, function (entry) {
                                    requestStationsOfService(entry.serviceID, entry.url, createMarkers, entry.phenomenonID);
                                });
                            } else {
                                provider = statusService.status.apiProvider;
                                requestStationsOfService(provider.serviceID, provider.url, createMarkers);
                            }
                        }
                    }
                };

                var requestStationsOfService = function (serviceID, url, callback, phenomenonID) {
                    var params = {
                        service: serviceID,
                        phenomenon: phenomenonID
                    };
                    interfaceService.getStations(null, url, params).then(function (data) {
                        callback(data, url, serviceID);
                    });
                };

                var requestAggregatedStations = function (phenomenon) {
                    aggregateCounter = 0;
                    aggregateBounds = null;
                    angular.copy({}, map.paths);
                    angular.copy({}, map.bounds);
                    if (phenomenon) {
                        angular.forEach(phenomenon.provider, function (entry) {
                            aggregateCounter++;
                            requestStationsOfService(entry.serviceID, entry.url, createAggregatedStations, entry.phenomenonID);
                        });
                    } else {
                        angular.forEach(settingsService.restApiUrls, function (id, url) {
                            interfaceService.getServices(url).then(function (providers) {
                                angular.forEach(providers, function (provider) {
                                    if (!utils.isServiceBlacklisted(provider.id, url)) {
                                        aggregateCounter++;
                                        interfaceService.getStations(null, url, {
                                            service: provider.id,
                                            phenomenon: phenomenon
                                        }).then(function (data) {
                                            createAggregatedStations(data, url, provider.id + id);
                                        });
                                    }
                                });
                            });
                        });
                    }
                };

                var createAggregatedStations = function (data, serviceUrl, serviceId) {
                    aggregateCounter--;
                    if (data.length > 0) {
                        var firstElemCoord = getCoordinates(data[0]);
                        if (!angular.isObject(aggregateBounds)) {
                            aggregateBounds = {
                                topmost: firstElemCoord[1],
                                bottommost: firstElemCoord[1],
                                leftmost: firstElemCoord[0],
                                rightmost: firstElemCoord[0]
                            };
                        }
                        angular.forEach(data, function (elem) {
                            var geom = getCoordinates(elem);
                            if (!isNaN(geom[0]) || !isNaN(geom[1])) {
                                if (geom[0] > aggregateBounds.rightmost) {
                                    aggregateBounds.rightmost = geom[0];
                                }
                                if (geom[0] < aggregateBounds.leftmost) {
                                    aggregateBounds.leftmost = geom[0];
                                }
                                if (geom[1] > aggregateBounds.topmost) {
                                    aggregateBounds.topmost = geom[1];
                                }
                                if (geom[1] < aggregateBounds.bottommost) {
                                    aggregateBounds.bottommost = geom[1];
                                }
                                if (statusService.status.concentrationMarker && isTimeseries(elem)) {
                                    addColoredCircle(geom, elem);
                                } else {
                                    addNormalMarker(geom, elem, serviceUrl, serviceId);
                                }
                            }
                        });
                        if (aggregateCounter === 0)
                            setBounds(aggregateBounds.bottommost, aggregateBounds.leftmost, aggregateBounds.topmost, aggregateBounds.rightmost);
                    }
                    if (aggregateCounter === 0)
                        map.loading = false;
                };

                var createMarkers = function (data, serviceUrl, serviceId) {
                    angular.copy({}, map.paths);
                    angular.copy({}, map.bounds);
                    if (data.length > 0) {
                        var firstElemCoord = getCoordinates(data[0]);
                        var topmost = firstElemCoord[1];
                        var bottommost = firstElemCoord[1];
                        var leftmost = firstElemCoord[0];
                        var rightmost = firstElemCoord[0];
                        angular.forEach(data, function (elem) {
                            var geom = getCoordinates(elem);
                            if (!isNaN(geom[0]) || !isNaN(geom[1])) {
                                if (geom[0] > rightmost) {
                                    rightmost = geom[0];
                                }
                                if (geom[0] < leftmost) {
                                    leftmost = geom[0];
                                }
                                if (geom[1] > topmost) {
                                    topmost = geom[1];
                                }
                                if (geom[1] < bottommost) {
                                    bottommost = geom[1];
                                }
                                if (statusService.status.concentrationMarker && isTimeseries(elem)) {
                                    addColoredCircle(geom, elem, serviceUrl, serviceId);
                                } else {
                                    addNormalMarker(geom, elem, serviceUrl, serviceId);
                                }
                            }
                        });
                        setBounds(bottommost, leftmost, topmost, rightmost);
                    }
                    map.loading = false;
                };

                var setBounds = function (bottommost, leftmost, topmost, rightmost) {
                    if (bottommost === topmost && leftmost === rightmost) {
                        var southWest = L.latLng(parseFloat(bottommost), parseFloat(leftmost)),
                                northEast = L.latLng(parseFloat(topmost), parseFloat(rightmost)),
                                bounds = L.latLngBounds(southWest, northEast),
                                center = bounds.getCenter();
                        angular.copy({
                            lat: center.lat,
                            lng: center.lng,
                            zoom: 12
                        }, map.center);
                    } else {
                        angular.copy(leafletBoundsHelpers.createBoundsFromArray([
                            [parseFloat(bottommost), parseFloat(leftmost)],
                            [parseFloat(topmost), parseFloat(rightmost)]]), map.bounds);
                    }
                };

                var isTimeseries = function (elem) {
                    return angular.isDefined(elem.station);
                };

                var getCoordinates = function (elem) {
                    if (elem.geometry && elem.geometry.coordinates) {
                        return elem.geometry.coordinates;
                    } else {
                        return elem.station.geometry.coordinates;
                    }
                };

                var addNormalMarker = function (geom, elem, serviceUrl, serviceId) {
                    var marker = {
                        lat: geom[1],
                        lng: geom[0],
                        icon: stationMarkerIcon,
                        stationsId: elem.properties.id,
                        url: serviceUrl
                    };
                    if (statusService.status.clusterStations) {
                        marker.layer = 'cluster';
                    }
                    map.markers[tidyUpStationId(elem.properties.id + serviceId)] = marker;
                };

                var addColoredCircle = function (geom, elem, serviceUrl, serviceId) {
                    var interval = getMatchingInterval(elem);
                    var fillcolor = interval && interval.color ? interval.color : settingsService.defaultMarkerColor;
                    map.paths[tidyUpStationId(elem.station.properties.id + serviceId)] = {
                        type: "circleMarker",
                        latlngs: {
                            lat: geom[1],
                            lng: geom[0]
                        },
                        color: '#000',
                        fillColor: fillcolor,
                        fill: true,
                        radius: 10,
                        weight: 2,
                        opacity: 1,
                        fillOpacity: 0.8,
                        stationsId: elem.station.properties.id,
                        url: serviceUrl
                    };
                };

                var tidyUpStationId = function (id) {
                    return id.replace('-', '');
                };

                var getMatchingInterval = function (elem) {
                    var matchedInterval = null;
                    if (elem.lastValue && elem.statusIntervals) {
                        var lastValue = elem.lastValue.value;
                        angular.forEach(elem.statusIntervals, function (interval) {
                            if (interval.upper === null) {
                                interval.upper = Number.MAX_VALUE;
                            }
                            if (interval.lower === null) {
                                interval.lower = Number.MIN_VALUE;
                            }
                            if (!isNaN(interval.upper) && !isNaN(interval.lower) && parseFloat(interval.lower) < lastValue && lastValue < parseFloat(interval.upper)) {
                                matchedInterval = interval;
                                return false;
                            }
                        });
                    }
                    return matchedInterval;
                };

                init();
                return {
                    map: map
                };
            }])
        .service('stationService', ['interfaceService', 'settingsService',
            function (interfaceService, settingsService) {
                var preselectFirstTimeseries = angular.isUndefined(settingsService.preselectedFirstTimeseriesInStationView) ? false : settingsService.preselectedFirstTimeseriesInStationView === true;
                var selectFirst,
                        station = {
                            entry: {}
                        };
                determineTimeseries = function (stationId, url) {
                    selectFirst = preselectFirstTimeseries;
                    station.entry = {};
                    interfaceService.getStations(stationId, url).then(function (result) {
                        station.entry = result;
                        angular.forEach(result.properties.timeseries, function (timeseries, id) {
                            timeseries.selected = selectFirst || !preselectFirstTimeseries;
                            selectFirst = false;
                            interfaceService.getTimeseries(id, url).then(function (ts) {
                                angular.extend(timeseries, ts);
                            });
                        });
                    });
                };

                return {
                    determineTimeseries: determineTimeseries,
                    preselectFirstTimeseries: preselectFirstTimeseries,
                    station: station
                };
            }]);