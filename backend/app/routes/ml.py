from flask import Blueprint, jsonify, request
from backend.app.services.ml import get_ml_model, get_ml_scaler, get_ml_encoders
from backend.app.utils import normalize_query_text, get_time_phase_from_iso

ml_bp = Blueprint("ml_bp", __name__)

@ml_bp.route("/predict", methods=["POST"])
def predict_aqi():
    try:
        model = get_ml_model()
        scaler = get_ml_scaler()
        encoders = get_ml_encoders()

        if not model or not scaler or not encoders:
            return jsonify({
                "error": "Machine Learning model is not loaded or unavailable."
            }), 503

        data = request.json
        if not data:
            return jsonify({"error": "No JSON payload provided"}), 400

        # Basic expected features: city, temperature, humidity, wind_speed, pm25, pm10, no2, so2, co, o3
        raw_city = normalize_query_text(data.get("city", "Delhi"))
        features = [
            float(data.get("temperature", 25.0)),
            float(data.get("humidity", 50.0)),
            float(data.get("wind_speed", 10.0)),
            float(data.get("pm25", 0.0)),
            float(data.get("pm10", 0.0)),
            float(data.get("no2", 0.0)),
            float(data.get("so2", 0.0)),
            float(data.get("co", 0.0)),
            float(data.get("o3", 0.0)),
        ]

        import pandas as pd
        import numpy as np

        df_input = pd.DataFrame([features], columns=[
            "temperature", "humidity", "wind_speed",
            "pm25", "pm10", "no2", "so2", "co", "o3"
        ])
        df_input_scaled = scaler.transform(df_input)

        city_encoder = encoders.get("city")
        if city_encoder:
            try:
                city_encoded = city_encoder.transform([raw_city])[0]
            except Exception:
                # Unseen city fallback
                city_encoded = 0
            df_input_scaled = np.column_stack((df_input_scaled, [city_encoded]))

        prediction = model.predict(df_input_scaled)
        predicted_aqi = max(0.0, float(prediction[0]))

        from backend.app.utils import get_category
        cat = get_category(int(round(predicted_aqi)))

        return jsonify({
            "predicted_aqi": predicted_aqi,
            "category": cat["level"],
            "color": cat["color"],
            "description": cat["text"]
        })

    except Exception as e:
        return jsonify({"error": f"Prediction failed: {str(e)}"}), 500


@ml_bp.route("/nlp/advice")
def nlp_advice():
    """Generates context-aware, step-by-step health advice using rules (previously mocked as NLP)."""
    city = normalize_query_text(request.args.get("city") or "Unknown")
    country = normalize_query_text(request.args.get("country") or "Unknown")
    
    try: aqi = float(request.args.get("aqi", 0))
    except: aqi = 0.0
    
    dominant = normalize_query_text(request.args.get("dominant") or "pm25")
    time_iso = request.args.get("timestamp_iso") or ""

    phase = get_time_phase_from_iso(time_iso)
    from backend.app.utils import get_category
    cat = get_category(int(round(aqi)))
    level = cat["level"].lower()

    # Base advice protocol
    advice = {
        "summary": f"The current AQI in {city.title()} is {int(aqi)} ({cat['level']}).",
        "primary_action": "",
        "action_steps": [],
        "risk_level": cat["level"],
        "color": cat["color"]
    }

    if "hazardous" in level or "very unhealthy" in level:
        advice["primary_action"] = "Stay indoors and use air purifiers."
        advice["action_steps"] = [
            "Keep all windows and doors closed.",
            "Turn on air purifiers (HEPA filter recommended) if available.",
            "Avoid all outdoor physical exertion.",
            "Wear an N95 or P100 mask if going outside is absolutely necessary."
        ]
    elif "unhealthy" in level:
        advice["primary_action"] = "Reduce prolonged or heavy outdoor exertion."
        advice["action_steps"] = [
            "Sensitive groups (children, elderly, asthmatics) should stay indoors.",
            "Consider wearing an N95 mask outdoors.",
            "Close windows to prevent outdoor smoke/pollution from entering."
        ]
    elif "moderate" in level:
        advice["primary_action"] = "Air quality is acceptable; unusually sensitive people should consider reducing outdoor exertion."
        advice["action_steps"] = [
            "Good time for normal activities for the general public.",
            "Asthmatics should keep inhalers handy if engaging in heavy outdoor exercises."
        ]
    else:
        advice["primary_action"] = "Enjoy your outdoor activities."
        advice["action_steps"] = [
            "Air quality is ideal for outdoor exercises and opening windows for ventilation."
        ]

    # Time-based overrides
    if phase == "night" and aqi > 100:
        advice["action_steps"].append("Ensure bedroom windows are closed while sleeping to prevent particulate buildup.")

    return jsonify({"data": advice}), 200
