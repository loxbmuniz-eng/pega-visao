"""Registro de estratégias — é por aqui que a CLI acha cada uma pelo nome."""
from .base import Estrategia
from .media_movel import MediaMovel
from .rompimento import Rompimento
from .reversao import Reversao

REGISTRO = {
    "media_movel": MediaMovel,
    "rompimento": Rompimento,
    "reversao": Reversao,
}

__all__ = ["Estrategia", "MediaMovel", "Rompimento", "Reversao", "REGISTRO"]
