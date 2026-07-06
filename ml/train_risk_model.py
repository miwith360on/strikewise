import argparse
from app import train_risk_model, RISK_HORIZON_MINUTES, RISK_RADIUS_KM


def main() -> None:
    parser = argparse.ArgumentParser(description='Train Strikewise lightning risk model')
    parser.add_argument('--lat', type=float, required=True, help='Monitored latitude')
    parser.add_argument('--lng', type=float, required=True, help='Monitored longitude')
    parser.add_argument('--horizon-minutes', type=int, default=RISK_HORIZON_MINUTES)
    parser.add_argument('--radius-km', type=float, default=RISK_RADIUS_KM)
    args = parser.parse_args()

    result = train_risk_model(
        monitored_lat=args.lat,
        monitored_lng=args.lng,
        horizon_minutes=args.horizon_minutes,
        radius_km=args.radius_km,
    )
    print(result)


if __name__ == '__main__':
    main()
