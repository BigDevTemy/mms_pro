<?php

class Jwt
{
    public static function base64UrlEncode(string $data): string
    {
        return rtrim(strtr(base64_encode($data), '+/', '-_'), '=');
    }

    public static function base64UrlDecode(string $data): string
    {
        $remainder = strlen($data) % 4;
        if ($remainder) {
            $padlen = 4 - $remainder;
            $data .= str_repeat('=', $padlen);
        }
        return base64_decode(strtr($data, '-_', '+/'));
    }

    public static function sign(array $payload, string $secret, string $issuer, int $ttlSeconds = 86400): string
    {
        $header = ['alg' => 'HS256', 'typ' => 'JWT'];
        $now = time();
        $payload = array_merge($payload, [
            'iss' => $issuer,
            'iat' => $now,
            'exp' => $now + $ttlSeconds,
        ]);
        $segments = [
            self::base64UrlEncode(json_encode($header)),
            self::base64UrlEncode(json_encode($payload)),
        ];
        $signingInput = implode('.', $segments);
        $signature = hash_hmac('sha256', $signingInput, $secret, true);
        $segments[] = self::base64UrlEncode($signature);
        return implode('.', $segments);
    }

    public static function verify(string $jwt, string $secret, ?string $issuer = null): array
    {
        $parts = explode('.', $jwt);
        if (count($parts) !== 3) {
            throw new Exception('Invalid token');
        }
        [$h64, $p64, $s64] = $parts;
        $header = json_decode(self::base64UrlDecode($h64), true);
        $payload = json_decode(self::base64UrlDecode($p64), true);
        $signature = self::base64UrlDecode($s64);
        if (!is_array($header) || !is_array($payload)) {
            throw new Exception('Invalid token');
        }
        if (($header['alg'] ?? '') !== 'HS256') {
            throw new Exception('Unsupported alg');
        }
        $signingInput = $h64 . '.' . $p64;
        $expected = hash_hmac('sha256', $signingInput, $secret, true);
        if (!hash_equals($expected, $signature)) {
            throw new Exception('Invalid signature');
        }
        if (isset($payload['exp']) && time() >= (int)$payload['exp']) {
            throw new Exception('Token expired');
        }
        if ($issuer !== null && isset($payload['iss']) && $payload['iss'] !== $issuer) {
            throw new Exception('Invalid issuer');
        }
        return $payload;
    }
}


