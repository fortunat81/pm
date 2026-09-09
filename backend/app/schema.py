"""Shared Pydantic models for the Kanban board data document.

Used by both the kanban router (`app/kanban.py`) and the AI chat feature
(`app/chat.py`). Mirrors the frontend `BoardData` shape.
"""
from pydantic import BaseModel, ConfigDict, model_validator


class CardModel(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    title: str
    details: str


class ColumnModel(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    title: str
    cardIds: list[str]


class BoardDataModel(BaseModel):
    model_config = ConfigDict(extra="forbid")

    columns: list[ColumnModel]
    cards: dict[str, CardModel]

    @model_validator(mode="after")
    def _cardIds_reference_existing_cards(self) -> "BoardDataModel":
        """Reject a board where a column references a card id that doesn't exist."""
        known_ids = set(self.cards)
        for column in self.columns:
            missing = [cid for cid in column.cardIds if cid not in known_ids]
            if missing:
                raise ValueError(
                    f"Column '{column.id}' references unknown card id(s): {missing}"
                )
        return self


class BoardUpdate(BaseModel):
    data: BoardDataModel
    version: int
