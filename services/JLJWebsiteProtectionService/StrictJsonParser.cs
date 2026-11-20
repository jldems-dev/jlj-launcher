using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;

namespace JLJ.WebsiteProtection
{
    internal sealed class StrictJsonParser
    {
        private readonly string _text;
        private int _position;
        private const int MaximumDepth = 24;

        private StrictJsonParser(string text) { _text = text; }

        internal static object Parse(string text)
        {
            if (text == null) throw new FormatException("Invalid JSON");
            StrictJsonParser parser = new StrictJsonParser(text);
            object value = parser.ReadValue(0);
            parser.SkipWhitespace();
            if (parser._position != text.Length) throw new FormatException("Invalid JSON");
            return value;
        }

        private object ReadValue(int depth)
        {
            if (depth > MaximumDepth) throw new FormatException("JSON nesting exceeds limit");
            SkipWhitespace();
            if (_position >= _text.Length) throw new FormatException("Incomplete JSON");
            char current = _text[_position];
            if (current == '{') return ReadObject(depth + 1);
            if (current == '[') return ReadArray(depth + 1);
            if (current == '"') return ReadString();
            if (current == 't') { ReadLiteral("true"); return true; }
            if (current == 'f') { ReadLiteral("false"); return false; }
            if (current == 'n') { ReadLiteral("null"); return null; }
            if (current == '-' || (current >= '0' && current <= '9')) return ReadInteger();
            throw new FormatException("Invalid JSON value");
        }

        private Dictionary<string, object> ReadObject(int depth)
        {
            _position++;
            SkipWhitespace();
            Dictionary<string, object> result = new Dictionary<string, object>(StringComparer.Ordinal);
            if (Take('}')) return result;
            while (true)
            {
                SkipWhitespace();
                if (_position >= _text.Length || _text[_position] != '"') throw new FormatException("Invalid JSON object key");
                string key = ReadString();
                if (result.ContainsKey(key)) throw new FormatException("Duplicate JSON field");
                SkipWhitespace();
                Require(':');
                result.Add(key, ReadValue(depth));
                SkipWhitespace();
                if (Take('}')) return result;
                Require(',');
            }
        }

        private List<object> ReadArray(int depth)
        {
            _position++;
            SkipWhitespace();
            List<object> result = new List<object>();
            if (Take(']')) return result;
            while (true)
            {
                result.Add(ReadValue(depth));
                SkipWhitespace();
                if (Take(']')) return result;
                Require(',');
            }
        }

        private string ReadString()
        {
            Require('"');
            StringBuilder value = new StringBuilder();
            while (_position < _text.Length)
            {
                char current = _text[_position++];
                if (current == '"') return value.ToString();
                if (current < 0x20) throw new FormatException("Invalid JSON string");
                if (current != '\\') { value.Append(current); continue; }
                if (_position >= _text.Length) throw new FormatException("Invalid JSON escape");
                char escaped = _text[_position++];
                switch (escaped)
                {
                    case '"': value.Append('"'); break;
                    case '\\': value.Append('\\'); break;
                    case '/': value.Append('/'); break;
                    case 'b': value.Append('\b'); break;
                    case 'f': value.Append('\f'); break;
                    case 'n': value.Append('\n'); break;
                    case 'r': value.Append('\r'); break;
                    case 't': value.Append('\t'); break;
                    case 'u':
                        if (_position + 4 > _text.Length) throw new FormatException("Invalid JSON unicode escape");
                        int code;
                        if (!Int32.TryParse(_text.Substring(_position, 4), NumberStyles.HexNumber, CultureInfo.InvariantCulture, out code))
                            throw new FormatException("Invalid JSON unicode escape");
                        value.Append((char)code);
                        _position += 4;
                        break;
                    default: throw new FormatException("Invalid JSON escape");
                }
            }
            throw new FormatException("Unterminated JSON string");
        }

        private long ReadInteger()
        {
            int start = _position;
            if (Take('-') && _position >= _text.Length) throw new FormatException("Invalid JSON number");
            if (Take('0'))
            {
                if (_position < _text.Length && Char.IsDigit(_text[_position])) throw new FormatException("Invalid JSON number");
            }
            else
            {
                if (_position >= _text.Length || _text[_position] < '1' || _text[_position] > '9') throw new FormatException("Invalid JSON number");
                while (_position < _text.Length && _text[_position] >= '0' && _text[_position] <= '9') _position++;
            }
            long value;
            if (!Int64.TryParse(_text.Substring(start, _position - start), NumberStyles.AllowLeadingSign, CultureInfo.InvariantCulture, out value))
                throw new FormatException("JSON number is out of range");
            if (_position < _text.Length && (_text[_position] == '.' || _text[_position] == 'e' || _text[_position] == 'E'))
                throw new FormatException("Only integer JSON numbers are accepted");
            return value;
        }

        private void ReadLiteral(string literal)
        {
            if (_position + literal.Length > _text.Length || String.CompareOrdinal(_text, _position, literal, 0, literal.Length) != 0)
                throw new FormatException("Invalid JSON literal");
            _position += literal.Length;
        }

        private void SkipWhitespace()
        {
            while (_position < _text.Length && (_text[_position] == ' ' || _text[_position] == '\t' || _text[_position] == '\r' || _text[_position] == '\n')) _position++;
        }

        private bool Take(char expected)
        {
            if (_position < _text.Length && _text[_position] == expected) { _position++; return true; }
            return false;
        }

        private void Require(char expected)
        {
            if (!Take(expected)) throw new FormatException("Invalid JSON structure");
        }
    }
}
